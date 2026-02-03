package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
)

type RawEvent struct {
	EventID        string                 `json:"event_id"`
	OrganizationID string                 `json:"organization_id"`
	SourceType     string                 `json:"source_type"`
	EventType      string                 `json:"event_type"`
	SourceID       string                 `json:"source_id"`
	Payload        map[string]interface{} `json:"payload"`
}

type NormalizedRecordEvent struct {
	NormalizedID   string                 `json:"normalized_id"`
	OrganizationID string                 `json:"organization_id"`
	SourceType     string                 `json:"source_type"`
	SourceID       string                 `json:"source_id"`
	EventType      string                 `json:"event_type"`
	Record         map[string]interface{} `json:"record"`
	Normalized     map[string]interface{} `json:"normalized"`
	Ingest         map[string]interface{} `json:"ingest"`
	ConnectorType  string                 `json:"connector_type,omitempty"`
	ConnectionID   string                 `json:"connection_id,omitempty"`
}

func main() {
	bootstrapServers := getEnv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
	rawTopic := getEnv("KAFKA_TOPIC_RAW_EVENTS", "raw.connector.events")
	normalizedTopic := getEnv("KAFKA_TOPIC_NORMALIZED_RECORDS", "normalized.records")
	groupID := getEnv("KAFKA_CONSUMER_GROUP_ID", "drovi-ingestion-worker")
	logLevel := getEnv("LOG_LEVEL", "INFO")

	if strings.EqualFold(logLevel, "DEBUG") {
		log.SetFlags(log.LstdFlags | log.Lshortfile)
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        strings.Split(bootstrapServers, ","),
		GroupID:        groupID,
		Topic:          rawTopic,
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
	})
	defer reader.Close()

	writer := &kafka.Writer{
		Addr:         kafka.TCP(strings.Split(bootstrapServers, ",")...),
		Topic:        normalizedTopic,
		BatchTimeout: 50 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
		Async:        true,
	}
	defer writer.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigch := make(chan os.Signal, 1)
	signal.Notify(sigch, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigch
		log.Printf("shutdown signal received")
		cancel()
	}()

	log.Printf("Go ingestion worker started. raw_topic=%s normalized_topic=%s group_id=%s", rawTopic, normalizedTopic, groupID)

	for {
		msg, err := reader.ReadMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				break
			}
			log.Printf("read message error: %v", err)
			continue
		}

		var raw RawEvent
		if err := json.Unmarshal(msg.Value, &raw); err != nil {
			log.Printf("invalid message payload: %v", err)
			continue
		}

		if strings.EqualFold(raw.EventType, "connector.webhook") {
			continue
		}

		normalized, err := normalizeRawEvent(raw, msg.Headers)
		if err != nil {
			log.Printf("normalize error: %v", err)
			continue
		}
		if normalized == nil {
			continue
		}

		payload, err := json.Marshal(normalized)
		if err != nil {
			log.Printf("marshal normalized error: %v", err)
			continue
		}

		err = writer.WriteMessages(ctx, kafka.Message{
			Key:   []byte(normalized.OrganizationID + ":" + normalized.NormalizedID),
			Value: payload,
			Headers: []kafka.Header{
				{Key: "organization_id", Value: []byte(normalized.OrganizationID)},
			},
		})
		if err != nil {
			log.Printf("failed to write normalized record: %v", err)
		}
	}

	log.Printf("Go ingestion worker stopped")
}

func normalizeRawEvent(raw RawEvent, headers []kafka.Header) (*NormalizedRecordEvent, error) {
	orgID := strings.TrimSpace(raw.OrganizationID)
	if orgID == "" {
		return nil, nil
	}

	payload := raw.Payload
	if payload == nil {
		payload = map[string]interface{}{}
	}

	connectorType := asString(payload["connector_type"])
	connectionID := asString(payload["connection_id"])
	jobType := asString(payload["job_type"])

	recordPayload, _ := payload["record"].(map[string]interface{})
	contentPayload := payload
	if recordPayload != nil {
		if data, ok := recordPayload["data"].(map[string]interface{}); ok && len(data) > 0 {
			contentPayload = data
		}
	}

	content, subject := extractContent(contentPayload)
	conversationID := pickString(contentPayload, "conversation_id", "thread_id", "channel_id", "chat_id", "meeting_id")
	userEmail := pickString(contentPayload, "sender_email", "owner_email", "author_email", "organizer_email", "from")
	userName := pickString(contentPayload, "sender_name", "owner_name", "author_name", "organizer_name", "from_name")

	sourceType := defaultSourceType(connectorType, raw.SourceType)
	messageID := ""
	if recordPayload != nil {
		messageID = asString(recordPayload["record_id"])
	}
	if messageID == "" {
		messageID = raw.SourceID
	}
	sourceID := raw.SourceID
	if sourceID == "" {
		sourceID = messageID
	}

	priorityHeader := headerValue(headers, "priority")
	ingest := buildIngestMetadata(content, sourceType, sourceID, conversationID, messageID, jobType, priorityHeader)

	normalized := map[string]interface{}{
		"content":         content,
		"metadata":        map[string]interface{}{"raw_event_type": raw.EventType, "raw_payload": payload},
		"conversation_id": conversationID,
		"user_email":      userEmail,
		"user_name":       userName,
		"subject":         subject,
	}

	record := recordPayload
	if record == nil {
		record = map[string]interface{}{}
	}

	return &NormalizedRecordEvent{
		NormalizedID:   uuid.New().String(),
		OrganizationID: orgID,
		SourceType:     sourceType,
		SourceID:       sourceID,
		EventType:      raw.EventType,
		Record:         record,
		Normalized:     normalized,
		Ingest:         ingest,
		ConnectorType:  connectorType,
		ConnectionID:   connectionID,
	}, nil
}

func extractContent(payload map[string]interface{}) (string, string) {
	subject := firstNonEmpty(
		asString(payload["subject"]),
		asString(payload["summary"]),
		asString(payload["title"]),
		asString(payload["name"]),
	)
	body := firstNonEmpty(
		asString(payload["body"]),
		asString(payload["body_text"]),
		asString(payload["text"]),
		asString(payload["content"]),
		asString(payload["content_text"]),
		asString(payload["description"]),
	)
	parts := []string{}
	if subject != "" {
		parts = append(parts, "Subject: "+subject)
	}
	if body != "" {
		parts = append(parts, body)
	}
	return strings.TrimSpace(strings.Join(parts, "\n\n")), subject
}

func defaultSourceType(connectorType string, fallback string) string {
	mapping := map[string]string{
		"gmail":           "email",
		"outlook":         "email",
		"slack":           "slack",
		"notion":          "notion",
		"google_docs":     "google_docs",
		"google_calendar": "calendar",
		"hubspot":         "crm",
		"teams":           "teams",
		"whatsapp":        "whatsapp",
		"s3":              "s3",
		"bigquery":        "bigquery",
		"postgres":        "postgresql",
		"mysql":           "mysql",
		"mongodb":         "mongodb",
	}
	if mapped, ok := mapping[strings.ToLower(connectorType)]; ok {
		return mapped
	}
	if fallback != "" {
		return fallback
	}
	return "api"
}

func buildIngestMetadata(content, sourceType, sourceID, conversationID, messageID, jobType, explicitPriority string) map[string]interface{} {
	fingerprint := buildSourceFingerprint(sourceType, sourceID, conversationID, messageID)
	contentHash := buildContentHash(content, fingerprint)
	priority := computePriority(sourceType, jobType, explicitPriority)
	return map[string]interface{}{
		"priority":         priority,
		"content_hash":     contentHash,
		"source_fingerprint": fingerprint,
		"job_type":         jobType,
	}
}

func buildSourceFingerprint(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized = append(normalized, part)
	}
	return strings.Join(normalized, "|")
}

func buildContentHash(content, fingerprint string) string {
	payload := fingerprint + "::" + content
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func computePriority(sourceType, jobType, explicit string) int {
	if explicit != "" {
		if parsed := parsePriorityValue(explicit); parsed != nil {
			return *parsed
		}
	}
	sourcePriority := map[string]int{
		"connector_webhook": 0,
		"webhook":           0,
		"email":             3,
		"slack":             3,
		"meeting":           4,
		"call":              4,
		"transcript":        4,
		"calendar":          5,
		"document":          6,
		"notion":            6,
		"google_docs":       6,
		"crm":               7,
		"whatsapp":          6,
		"api":               6,
		"manual":            7,
	}
	jobPriority := map[string]int{
		"webhook":   0,
		"on_demand": 2,
		"scheduled": 5,
		"backfill":  8,
	}
	defaultPriority := 5
	sourceKey := strings.ToLower(sourceType)
	jobKey := strings.ToLower(jobType)

	priority := defaultPriority
	if val, ok := sourcePriority[sourceKey]; ok {
		priority = val
	}
	if val, ok := jobPriority[jobKey]; ok {
		if val <= 1 {
			priority = val
		} else if val >= 8 {
			if priority < val {
				priority = val
			}
		} else if val < priority {
			priority = val
		}
	}
	return priority
}

func parsePriorityValue(value string) *int {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return nil
	}
	if parsed, err := strconv.Atoi(value); err == nil {
		return &parsed
	}
	mapper := map[string]int{
		"critical":   0,
		"urgent":     1,
		"high":       2,
		"normal":     5,
		"default":    5,
		"low":        8,
		"background": 9,
	}
	if mapped, ok := mapper[value]; ok {
		return &mapped
	}
	return nil
}

func pickString(payload map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value := asString(payload[key]); value != "" {
			return value
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func asString(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []byte:
		return strings.TrimSpace(string(v))
	default:
		return ""
	}
}

func headerValue(headers []kafka.Header, key string) string {
	for _, header := range headers {
		if strings.EqualFold(header.Key, key) {
			return strings.TrimSpace(string(header.Value))
		}
	}
	return ""
}

func getEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
