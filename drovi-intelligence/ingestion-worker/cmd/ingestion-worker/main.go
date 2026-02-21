package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/mail"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/scram"
)

type RawEvent struct {
	EventID        string                 `json:"event_id"`
	OrganizationID string                 `json:"organization_id"`
	SourceType     string                 `json:"source_type"`
	EventType      string                 `json:"event_type"`
	SourceID       string                 `json:"source_id"`
	Payload        map[string]interface{} `json:"payload"`
}

type KafkaEnvelope[T any] struct {
	MessageID string `json:"message_id"`
	Timestamp string `json:"timestamp"`
	Payload   T      `json:"payload"`
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

var (
	htmlCommentRe    = regexp.MustCompile(`(?s)<!--.*?-->`)
	htmlStripBlockRe = regexp.MustCompile(`(?is)<(?:script|style|head|title|meta|link)[^>]*>.*?</(?:script|style|head|title|meta|link)>`)
	htmlBreakRe      = regexp.MustCompile(`(?i)<br\s*/?>`)
	htmlBlockEndRe   = regexp.MustCompile(`(?i)</(p|div|li|tr|h[1-6]|section|article|blockquote)>`)
	htmlTagRe        = regexp.MustCompile(`(?s)<[^>]+>`)
	htmlHintRe       = regexp.MustCompile(`(?i)</?[a-z][^>]*>`)
	inlineWsRe       = regexp.MustCompile(`[ \t\f\v]+`)
	multiNlRe        = regexp.MustCompile(`\n{3,}`)
)

func main() {
	bootstrapServers := getEnv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
	rawTopic := getEnv("KAFKA_TOPIC_RAW_EVENTS", "raw.connector.events")
	normalizedTopic := getEnv("KAFKA_TOPIC_NORMALIZED_RECORDS", "normalized.records")
	groupID := getEnv("KAFKA_CONSUMER_GROUP_ID", "drovi-ingestion-worker")
	logLevel := getEnv("LOG_LEVEL", "INFO")
	securityProtocol := strings.ToUpper(getEnv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT"))
	saslMechanism := strings.ToUpper(getEnv("KAFKA_SASL_MECHANISM", "SCRAM-SHA-512"))
	saslUsername := getEnv("KAFKA_SASL_USERNAME", "")
	saslPassword := getEnv("KAFKA_SASL_PASSWORD", "")

	dialer, transport, err := buildKafkaConnConfig(
		securityProtocol,
		saslMechanism,
		saslUsername,
		saslPassword,
	)
	if err != nil {
		log.Fatalf("failed to configure Kafka connection: %v", err)
	}

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
		Dialer:         dialer,
	})
	defer reader.Close()

	writer := &kafka.Writer{
		Addr:         kafka.TCP(strings.Split(bootstrapServers, ",")...),
		Topic:        normalizedTopic,
		BatchTimeout: 50 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
		Async:        true,
		Transport:    transport,
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
		var envelope KafkaEnvelope[RawEvent]
		if err := json.Unmarshal(msg.Value, &envelope); err != nil {
			log.Printf("invalid message payload: %v", err)
			continue
		}
		raw = envelope.Payload

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

		normalizedEnvelope := KafkaEnvelope[NormalizedRecordEvent]{
			MessageID: uuid.New().String(),
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			Payload:   *normalized,
		}

		payload, err := json.Marshal(normalizedEnvelope)
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
	userEmail, userName := extractSender(contentPayload)
	recipientEmails, ccEmails := extractParticipants(contentPayload)

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

	rawMetadata := map[string]interface{}{
		"sender_email": userEmail,
		"sender_name":  userName,
	}
	if len(recipientEmails) > 0 {
		rawMetadata["recipient_emails"] = recipientEmails
		rawMetadata["attendees"] = recipientEmails
	}
	if len(ccEmails) > 0 {
		rawMetadata["cc_emails"] = ccEmails
	}

	unifiedMetadata := map[string]interface{}{
		"sender_email":     userEmail,
		"sender_name":      userName,
		"recipient_emails": recipientEmails,
		"cc_emails":        ccEmails,
	}

	normalized := map[string]interface{}{
		"content":         content,
		"metadata":        map[string]interface{}{"raw_event_type": raw.EventType, "raw_payload": payload, "raw": rawMetadata, "unified": unifiedMetadata},
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

func buildKafkaConnConfig(
	securityProtocol string,
	saslMechanism string,
	saslUsername string,
	saslPassword string,
) (*kafka.Dialer, *kafka.Transport, error) {
	dialer := &kafka.Dialer{
		Timeout:   10 * time.Second,
		DualStack: true,
	}

	transport := &kafka.Transport{}

	if strings.Contains(securityProtocol, "SSL") {
		tlsConfig := &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
		dialer.TLS = tlsConfig
		transport.TLS = tlsConfig
	}

	if strings.HasPrefix(securityProtocol, "SASL") {
		if saslUsername == "" || saslPassword == "" {
			return nil, nil, fmt.Errorf("SASL is enabled but credentials are missing")
		}

		algorithm := scram.SHA512
		if saslMechanism == "SCRAM-SHA-256" {
			algorithm = scram.SHA256
		}

		mechanism, err := scram.Mechanism(algorithm, saslUsername, saslPassword)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to initialize SCRAM mechanism: %w", err)
		}

		dialer.SASLMechanism = mechanism
		transport.SASL = mechanism
	}

	return dialer, transport, nil
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
	subject = sanitizeExtractionText(subject)
	body = sanitizeExtractionText(body)
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
		"priority":           priority,
		"content_hash":       contentHash,
		"source_fingerprint": fingerprint,
		"job_type":           jobType,
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

func sanitizeExtractionText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}

	if strings.Contains(text, "<") && strings.Contains(text, ">") && htmlHintRe.MatchString(text) {
		text = htmlCommentRe.ReplaceAllString(text, " ")
		text = htmlStripBlockRe.ReplaceAllString(text, " ")
		text = htmlBreakRe.ReplaceAllString(text, "\n")
		text = htmlBlockEndRe.ReplaceAllString(text, "\n")
		text = htmlTagRe.ReplaceAllString(text, " ")
	}

	text = html.UnescapeString(text)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = inlineWsRe.ReplaceAllString(text, " ")
	text = strings.ReplaceAll(text, " \n", "\n")
	text = strings.ReplaceAll(text, "\n ", "\n")
	text = multiNlRe.ReplaceAllString(text, "\n\n")
	return strings.TrimSpace(text)
}

func extractSender(payload map[string]interface{}) (string, string) {
	email := pickString(payload, "sender_email", "owner_email", "author_email", "organizer_email")
	name := pickString(payload, "sender_name", "owner_name", "author_name", "organizer_name")

	mergeNameEmail := func(value interface{}) {
		parsedName, parsedEmail := parseNameEmail(value)
		if email == "" {
			email = parsedEmail
		}
		if name == "" {
			name = parsedName
		}
	}

	if email == "" || name == "" {
		mergeNameEmail(payload["from"])
		mergeNameEmail(payload["sender"])
		mergeNameEmail(payload["author"])
		mergeNameEmail(payload["organizer"])
	}

	if headers, ok := payload["headers"].(map[string]interface{}); ok && (email == "" || name == "") {
		mergeNameEmail(pickHeaderValue(headers, "from"))
	}

	if email == "" {
		email = normalizeEmail(pickString(payload, "from"))
	}
	return email, strings.TrimSpace(name)
}

func extractParticipants(payload map[string]interface{}) ([]string, []string) {
	recipientEmails := collectEmails(
		payload["recipient_emails"],
		payload["to_emails"],
		payload["participants"],
		payload["attendee_emails"],
		payload["to"],
	)
	ccEmails := collectEmails(
		payload["cc_emails"],
		payload["cc"],
	)

	if headers, ok := payload["headers"].(map[string]interface{}); ok {
		recipientEmails = appendUniqueEmails(recipientEmails, collectEmails(pickHeaderValue(headers, "to"))...)
		ccEmails = appendUniqueEmails(ccEmails, collectEmails(pickHeaderValue(headers, "cc"))...)
	}

	return recipientEmails, ccEmails
}

func parseNameEmail(value interface{}) (string, string) {
	switch v := value.(type) {
	case string:
		return parseNameEmailString(v)
	case map[string]interface{}:
		name := firstNonEmpty(
			asString(v["name"]),
			asString(v["display_name"]),
			asString(v["displayName"]),
			asString(v["sender_name"]),
		)
		email := firstNonEmpty(
			normalizeEmail(asString(v["email"])),
			normalizeEmail(asString(v["address"])),
			normalizeEmail(asString(v["value"])),
			normalizeEmail(asString(v["sender_email"])),
		)
		if email == "" || name == "" {
			parsedName, parsedEmail := parseNameEmailString(asString(v["from"]))
			if name == "" {
				name = parsedName
			}
			if email == "" {
				email = parsedEmail
			}
		}
		return strings.TrimSpace(name), normalizeEmail(email)
	default:
		return "", ""
	}
}

func parseNameEmailString(value string) (string, string) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", ""
	}
	if addr, err := mail.ParseAddress(trimmed); err == nil {
		return strings.TrimSpace(addr.Name), normalizeEmail(addr.Address)
	}
	if addrs, err := mail.ParseAddressList(trimmed); err == nil && len(addrs) > 0 {
		return strings.TrimSpace(addrs[0].Name), normalizeEmail(addrs[0].Address)
	}
	return "", normalizeEmail(trimmed)
}

func collectEmails(values ...interface{}) []string {
	result := []string{}
	for _, value := range values {
		switch v := value.(type) {
		case nil:
			continue
		case string:
			result = appendUniqueEmails(result, parseEmailsFromString(v)...)
		case []string:
			for _, item := range v {
				result = appendUniqueEmails(result, parseEmailsFromString(item)...)
			}
		case []interface{}:
			for _, item := range v {
				result = appendUniqueEmails(result, collectEmails(item)...)
			}
		case map[string]interface{}:
			result = appendUniqueEmails(
				result,
				normalizeEmail(asString(v["email"])),
				normalizeEmail(asString(v["address"])),
				normalizeEmail(asString(v["value"])),
			)
			result = appendUniqueEmails(result, collectEmails(v["to"], v["cc"], v["participants"])...)
		default:
			if text := asString(v); text != "" {
				result = appendUniqueEmails(result, parseEmailsFromString(text)...)
			}
		}
	}
	return result
}

func parseEmailsFromString(value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	result := []string{}

	if addrs, err := mail.ParseAddressList(trimmed); err == nil && len(addrs) > 0 {
		for _, addr := range addrs {
			result = appendUniqueEmails(result, addr.Address)
		}
		if len(result) > 0 {
			return result
		}
	}

	if addr, err := mail.ParseAddress(trimmed); err == nil {
		return appendUniqueEmails(result, addr.Address)
	}

	for _, part := range strings.Split(trimmed, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if addr, err := mail.ParseAddress(part); err == nil {
			result = appendUniqueEmails(result, addr.Address)
			continue
		}
		result = appendUniqueEmails(result, part)
	}

	return result
}

func normalizeEmail(value string) string {
	email := strings.TrimSpace(value)
	if email == "" {
		return ""
	}

	if strings.Contains(email, "<") && strings.Contains(email, ">") {
		if addr, err := mail.ParseAddress(email); err == nil {
			email = addr.Address
		}
	}

	email = strings.Trim(email, "\"'<> ")
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return ""
	}
	return email
}

func appendUniqueEmails(existing []string, candidates ...string) []string {
	seen := make(map[string]struct{}, len(existing))
	for _, current := range existing {
		normalized := normalizeEmail(current)
		if normalized == "" {
			continue
		}
		seen[normalized] = struct{}{}
	}

	for _, candidate := range candidates {
		normalized := normalizeEmail(candidate)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		existing = append(existing, normalized)
	}
	return existing
}

func pickHeaderValue(headers map[string]interface{}, key string) string {
	for headerKey, value := range headers {
		if strings.EqualFold(headerKey, key) {
			return asString(value)
		}
	}
	return ""
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
