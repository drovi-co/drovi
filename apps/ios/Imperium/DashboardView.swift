import SwiftUI
import UIKit
import Security

struct DashboardView: View {
    @StateObject private var viewModel = ImperiumMobileViewModel()
    @State private var selectedTab: ImperiumTab = .brief
    @State private var showContextPanel = false

    var body: some View {
        GeometryReader { proxy in
            TabView(selection: $selectedTab) {
                BriefTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Brief", systemImage: "doc.text")
                    }
                    .tag(ImperiumTab.brief)

                MarketsTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Markets", systemImage: "chart.xyaxis.line")
                    }
                    .tag(ImperiumTab.markets)

                PortfolioTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Portfolio", systemImage: "briefcase")
                    }
                    .tag(ImperiumTab.portfolio)

                BusinessTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Business", systemImage: "building.2")
                    }
                    .tag(ImperiumTab.business)

                IntelligenceTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Intelligence", systemImage: "newspaper")
                    }
                    .tag(ImperiumTab.intelligence)
            }
            .tint(ImperiumPalette.gold)
            .background(ImperiumPalette.black.ignoresSafeArea())
            .task {
                await viewModel.refresh()
            }
            .refreshable {
                await viewModel.refresh()
            }
            .overlay(alignment: .top) {
                HeaderRail(
                    syncState: viewModel.syncState,
                    sessionState: viewModel.sessionState,
                    lastSync: viewModel.lastSync
                )
                    .padding(.top, 8)
                    .padding(.horizontal, 16)
            }
            .safeAreaInset(edge: .bottom) {
                Text("Swipe from right edge for Context AI")
                    .font(.footnote)
                    .foregroundStyle(ImperiumPalette.muted)
                    .padding(.bottom, 4)
            }
            .gesture(
                DragGesture(minimumDistance: 16)
                    .onEnded { value in
                        let startsAtRightEdge = value.startLocation.x >= proxy.size.width - 18
                        let swipedLeft = value.translation.width < -48
                        if startsAtRightEdge && swipedLeft {
                            showContextPanel = true
                        }
                    }
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showContextPanel = true
                    } label: {
                        Label("Context", systemImage: "sparkles.rectangle.stack")
                    }
                }
            }
            .sheet(isPresented: $showContextPanel) {
                ContextPanelView(viewModel: viewModel)
                    .presentationDetents([.fraction(0.45), .large])
                    .presentationDragIndicator(.visible)
            }
            .onOpenURL { url in
                handleDeepLink(url)
            }
            .onReceive(NotificationCenter.default.publisher(for: .imperiumDeepLink)) { notification in
                guard let url = notification.object as? URL else { return }
                handleDeepLink(url)
            }
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme?.lowercased() == "imperium" else { return }

        let candidate: String
        if let host = url.host, !host.isEmpty {
            candidate = host
        } else {
            candidate = url.pathComponents.dropFirst().first ?? ""
        }

        switch candidate.lowercased() {
        case "brief":
            selectedTab = .brief
        case "markets":
            selectedTab = .markets
        case "portfolio":
            selectedTab = .portfolio
        case "business":
            selectedTab = .business
        case "intelligence":
            selectedTab = .intelligence
        default:
            break
        }
    }
}

private enum ImperiumTab: String {
    case brief
    case markets
    case portfolio
    case business
    case intelligence
}

private enum ImperiumPalette {
    static let black = Color(red: 0.04, green: 0.04, blue: 0.04)
    static let charcoal = Color(red: 0.11, green: 0.11, blue: 0.11)
    static let steel = Color(red: 0.15, green: 0.15, blue: 0.15)
    static let gold = Color(red: 0.73, green: 0.60, blue: 0.38)
    static let forest = Color(red: 0.14, green: 0.24, blue: 0.19)
    static let burgundy = Color(red: 0.43, green: 0.18, blue: 0.23)
    static let text = Color(red: 0.92, green: 0.89, blue: 0.82)
    static let muted = Color(red: 0.70, green: 0.65, blue: 0.56)
}

@MainActor
private final class ImperiumMobileViewModel: ObservableObject {
    @Published var brief: BriefResponse = .fallback
    @Published var watchlistQuotes: [WatchlistQuote] = WatchlistQuote.fallback
    @Published var marketCandles: [CandlePoint] = CandlePoint.fallback
    @Published var portfolio: PortfolioOverviewResponse = .fallback
    @Published var business: BusinessOverviewResponse = .fallback
    @Published var businessAnomalies: [BusinessAnomalyResponse] = BusinessAnomalyResponse.fallback
    @Published var inbox: [InboxItemResponse] = InboxItemResponse.fallback
    @Published var clusters: [StoryClusterResponse] = StoryClusterResponse.fallback
    @Published var alerts: [AlertEventResponse] = AlertEventResponse.fallback
    @Published var reviewedClaimIDs: Set<String> = []
    @Published var sessionState = "Session pending"
    @Published var syncState = "Bootstrapped"
    @Published var lastSync = Date()

    private let api = ImperiumMobileAPI()
    private let deviceID = UIDevice.current.identifierForVendor?.uuidString ?? "imperium-ios-device"
    private let criticalFeedback = UINotificationFeedbackGenerator()
    private var alertStreamTask: Task<Void, Never>?
    private var marketStreamTask: Task<Void, Never>?

    init() {
        loadCachedSnapshot()
    }

    deinit {
        alertStreamTask?.cancel()
        marketStreamTask?.cancel()
    }

    func markReviewed(claimID: String) {
        reviewedClaimIDs.insert(claimID)
    }

    func refresh() async {
        syncState = "Syncing"

        do {
            let token = try await ensureSessionToken()

            let brief = try await api.fetch(BriefResponse.self, path: "/api/v1/imperium/brief/today", token: token)
            let watchlist = try await api.fetch([WatchlistEntry].self, path: "/api/v1/imperium/markets/watchlist", token: token)
            let portfolio = try await api.fetch(PortfolioOverviewResponse.self, path: "/api/v1/imperium/portfolio/overview", token: token)
            let business = try await api.fetch(BusinessOverviewResponse.self, path: "/api/v1/imperium/business/overview", token: token)
            let anomalies = try await api.fetch([BusinessAnomalyResponse].self, path: "/api/v1/imperium/business/anomalies", token: token)
            let inbox = try await api.fetch([InboxItemResponse].self, path: "/api/v1/imperium/intelligence/inbox", token: token)
            let clusters = try await api.fetch([StoryClusterResponse].self, path: "/api/v1/imperium/intelligence/clusters", token: token)
            let alerts = try await api.fetch([AlertEventResponse].self, path: "/api/v1/imperium/alerts/feed", token: token)

            var quotes: [WatchlistQuote] = []
            for entry in watchlist.prefix(8) {
                if let quote = try? await api.fetch(QuoteResponse.self, path: "/api/v1/imperium/markets/\(entry.symbol)/quote", token: token) {
                    quotes.append(
                        WatchlistQuote(
                            symbol: quote.symbol,
                            label: entry.label,
                            price: quote.price,
                            changePercent: quote.change_percent,
                            timestamp: quote.timestamp
                        )
                    )
                }
            }

            let firstSymbol = watchlist.first?.symbol ?? "SPY"
            let candles = (try? await api.fetch([CandleResponse].self, path: "/api/v1/imperium/markets/\(firstSymbol)/candles?interval=5m&limit=48", token: token)) ?? []

            self.brief = brief
            self.watchlistQuotes = quotes.isEmpty ? WatchlistQuote.fallback : quotes
            self.marketCandles = candles.map { CandlePoint(close: $0.close, timestamp: $0.end_time) }
            self.portfolio = portfolio
            self.business = business
            self.businessAnomalies = anomalies
            self.inbox = inbox
            self.clusters = clusters
            self.alerts = alerts
            cacheSnapshot()
            startStreamingIfNeeded(token: token)
            self.syncState = "Live"
        } catch {
            syncState = "Degraded"
        }

        lastSync = Date()
    }

    private func ensureSessionToken() async throws -> String {
        if let token = KeychainSessionStore.readToken(), !token.isEmpty {
            sessionState = "Session active"
            return token
        }

        let issued = try await api.issueSession(
            userID: "00000000-0000-0000-0000-000000000001",
            deviceID: deviceID
        )

        KeychainSessionStore.writeToken(issued.token)
        sessionState = "Session issued"
        return issued.token
    }

    private func startStreamingIfNeeded(token: String) {
        if marketStreamTask == nil {
            marketStreamTask = api.stream(
                path: "/api/v1/imperium/markets/stream/sse?subject=imperium.market.tick&event=market_update",
                token: token
            ) { [weak self] line in
                guard let self else { return }
                guard let data = line.data(using: .utf8),
                      let tick = try? JSONDecoder().decode(MarketTickStreamResponse.self, from: data)
                else {
                    return
                }

                if let index = self.watchlistQuotes.firstIndex(where: { $0.symbol == tick.symbol }) {
                    let existing = self.watchlistQuotes[index]
                    self.watchlistQuotes[index] = WatchlistQuote(
                        symbol: existing.symbol,
                        label: existing.label,
                        price: tick.price,
                        changePercent: existing.changePercent,
                        timestamp: tick.timestamp
                    )
                }
            }
        }

        if alertStreamTask == nil {
            alertStreamTask = api.stream(
                path: "/api/v1/imperium/alerts/stream/sse?subject=imperium.alert.event&event=alert_event",
                token: token
            ) { [weak self] line in
                guard let self else { return }
                guard let data = line.data(using: .utf8),
                      let event = try? JSONDecoder().decode(AlertEventResponse.self, from: data)
                else {
                    return
                }

                if self.alerts.contains(where: { $0.alert_id == event.alert_id }) {
                    return
                }

                self.alerts.insert(event, at: 0)
                self.alerts = Array(self.alerts.prefix(20))
                self.emitHaptic(for: event)
            }
        }
    }

    private func emitHaptic(for event: AlertEventResponse) {
        criticalFeedback.prepare()

        switch event.category.lowercased() {
        case "business", "risk", "macro":
            criticalFeedback.notificationOccurred(.warning)
        default:
            criticalFeedback.notificationOccurred(.success)
        }
    }

    private func loadCachedSnapshot() {
        let defaults = UserDefaults.standard
        if let briefData = defaults.data(forKey: "imperium.cached.brief"),
           let cachedBrief = try? JSONDecoder().decode(BriefResponse.self, from: briefData) {
            brief = cachedBrief
        }

        if let quoteData = defaults.data(forKey: "imperium.cached.watchlist_quotes"),
           let cachedQuotes = try? JSONDecoder().decode([WatchlistQuote].self, from: quoteData),
           !cachedQuotes.isEmpty {
            watchlistQuotes = cachedQuotes
        }

        if let candleData = defaults.data(forKey: "imperium.cached.candles"),
           let cachedCandles = try? JSONDecoder().decode([CandlePoint].self, from: candleData),
           !cachedCandles.isEmpty {
            marketCandles = cachedCandles
        }
    }

    private func cacheSnapshot() {
        let defaults = UserDefaults.standard
        if let briefData = try? JSONEncoder().encode(brief) {
            defaults.set(briefData, forKey: "imperium.cached.brief")
        }
        if let quoteData = try? JSONEncoder().encode(watchlistQuotes) {
            defaults.set(quoteData, forKey: "imperium.cached.watchlist_quotes")
        }
        if let candleData = try? JSONEncoder().encode(marketCandles) {
            defaults.set(candleData, forKey: "imperium.cached.candles")
        }
    }
}

private struct ImperiumMobileAPI {
    func fetch<T: Decodable>(_ type: T.Type, path: String, token: String?) async throws -> T {
        let url = endpointURL(path)
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        guard (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(type, from: data)
    }

    func issueSession(userID: String, deviceID: String) async throws -> SessionIssueResponse {
        let url = endpointURL("/api/v1/imperium/auth/session/token")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(SessionIssueRequest(user_id: userID, device_id: deviceID, ttl_seconds: 1_209_600))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode)
        else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(SessionIssueResponse.self, from: data)
    }

    func stream(path: String, token: String?, onEvent: @escaping @MainActor (String) -> Void) -> Task<Void, Never> {
        Task {
            let url = endpointURL(path)
            var request = URLRequest(url: url)
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            if let token, !token.isEmpty {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }

            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard let http = response as? HTTPURLResponse,
                      (200..<300).contains(http.statusCode)
                else {
                    return
                }

                for try await line in bytes.lines {
                    if Task.isCancelled {
                        break
                    }

                    guard line.hasPrefix("data:") else {
                        continue
                    }

                    let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                    guard !payload.isEmpty, payload != "keepalive" else {
                        continue
                    }

                    await onEvent(payload)
                }
            } catch {
                return
            }
        }
    }

    private func endpointURL(_ path: String) -> URL {
        URL(string: path, relativeTo: Config.apiBaseURL)?.absoluteURL ?? Config.apiBaseURL
    }
}

private struct SessionIssueRequest: Encodable {
    let user_id: String
    let device_id: String
    let ttl_seconds: Int
}

private struct SessionIssueResponse: Decodable {
    let token: String
}

private struct MarketTickStreamResponse: Decodable {
    let symbol: String
    let price: Double
    let volume: Double
    let timestamp: String
}

private enum KeychainSessionStore {
    private static let service = "app.imperium.command.ios"
    private static let account = "session_token"

    static func readToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8)
        else {
            return nil
        }

        return token
    }

    static func writeToken(_ token: String) {
        guard let data = token.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var creation = query
            creation[kSecValueData as String] = data
            SecItemAdd(creation as CFDictionary, nil)
        }
    }
}

private struct HeaderRail: View {
    let syncState: String
    let sessionState: String
    let lastSync: Date

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("Imperium")
                    .font(.system(size: 12, weight: .semibold, design: .serif))
                    .foregroundStyle(ImperiumPalette.muted)
                Text("Sovereign Command Center")
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .foregroundStyle(ImperiumPalette.gold)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(syncState)
                    .font(.caption.bold())
                    .foregroundStyle(syncState == "Live" ? ImperiumPalette.gold : ImperiumPalette.burgundy)
                Text(sessionState)
                    .font(.caption2)
                    .foregroundStyle(ImperiumPalette.muted)
                Text(lastSync.formatted(date: .omitted, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(ImperiumPalette.muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(ImperiumPalette.charcoal.opacity(0.93))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ImperiumPalette.steel, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct BriefTabView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel
    @State private var expandedClaimIDs: Set<String> = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CardSurface(title: "05:00 Strategic Brief", subtitle: viewModel.brief.generated_at) {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.brief.sections) { section in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(section.title)
                                        .font(.headline)
                                    Spacer()
                                    Text("\(section.claims.count) claims")
                                        .font(.caption)
                                        .foregroundStyle(ImperiumPalette.muted)
                                }
                                Text(section.summary)
                                    .font(.subheadline)
                                    .foregroundStyle(ImperiumPalette.text)
                                ForEach(section.claims) { claim in
                                    let claimID = "\(section.section_key)-\(claim.statement)"
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(claim.statement)
                                            .font(.footnote)
                                        Text("Impact \(claim.impact_score, specifier: "%.2f")  Confidence \(claim.confidence_score, specifier: "%.2f")")
                                            .font(.caption2)
                                            .foregroundStyle(ImperiumPalette.muted)
                                        if let action = claim.recommended_action, !action.isEmpty {
                                            Text("Action: \(action)")
                                                .font(.caption2)
                                                .foregroundStyle(ImperiumPalette.gold)
                                        }

                                        HStack(spacing: 12) {
                                            Button(expandedClaimIDs.contains(claimID) ? "Hide Sources" : "Show Sources") {
                                                if expandedClaimIDs.contains(claimID) {
                                                    expandedClaimIDs.remove(claimID)
                                                } else {
                                                    expandedClaimIDs.insert(claimID)
                                                }
                                            }
                                            .font(.caption)

                                            Button(viewModel.reviewedClaimIDs.contains(claimID) ? "Reviewed" : "Mark Reviewed") {
                                                viewModel.markReviewed(claimID: claimID)
                                            }
                                            .font(.caption)
                                            .disabled(viewModel.reviewedClaimIDs.contains(claimID))
                                        }

                                        if expandedClaimIDs.contains(claimID) {
                                            VStack(alignment: .leading, spacing: 4) {
                                                ForEach(claim.citations) { citation in
                                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text(citation.source_snippet)
                                                            .font(.caption2)
                                                            .foregroundStyle(ImperiumPalette.muted)
                                                        Link("Open source", destination: URL(string: citation.source_url) ?? URL(string: "https://example.com")!)
                                                            .font(.caption2)
                                                    }
                                                    .padding(.vertical, 2)
                                                }
                                            }
                                        }
                                    }
                                    .padding(8)
                                    .background(ImperiumPalette.steel.opacity(0.55))
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                            }
                            .padding(10)
                            .background(ImperiumPalette.steel.opacity(0.35))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }

                CardSurface(title: "Required Reads", subtitle: "Cited") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(viewModel.brief.required_reads.enumerated()), id: \.offset) { index, item in
                            Text("\(index + 1). \(item)")
                                .font(.subheadline)
                                .foregroundStyle(ImperiumPalette.text)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 36)
        }
        .background(ImperiumPalette.black.ignoresSafeArea())
    }
}

private struct MarketsTabView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CardSurface(title: "Markets Command", subtitle: "Realtime") {
                    VStack(spacing: 10) {
                        UIKitChartPlaceholder(candles: viewModel.marketCandles)
                            .frame(height: 220)

                        ForEach(viewModel.watchlistQuotes) { quote in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(quote.symbol)
                                        .font(.headline)
                                    Text(quote.label)
                                        .font(.caption)
                                        .foregroundStyle(ImperiumPalette.muted)
                                }
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(quote.price, format: .currency(code: "USD"))
                                    Text(quote.changePercentText)
                                        .font(.caption)
                                        .foregroundStyle(quote.changePercent >= 0 ? ImperiumPalette.forest : ImperiumPalette.burgundy)
                                }
                            }
                            .padding(10)
                            .background(ImperiumPalette.steel.opacity(0.45))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 36)
        }
        .background(ImperiumPalette.black.ignoresSafeArea())
    }
}

private struct PortfolioTabView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CardSurface(title: "Portfolio Command", subtitle: viewModel.portfolio.as_of) {
                    VStack(alignment: .leading, spacing: 10) {
                        MetricStrip(label: "Net Worth", value: viewModel.portfolio.net_worth, isCurrency: true)
                        MetricStrip(label: "Daily", value: viewModel.portfolio.daily_change, isCurrency: true)
                        MetricStrip(label: "YTD", value: viewModel.portfolio.ytd_change, isCurrency: true)
                        MetricStrip(label: "Risk Score", value: viewModel.portfolio.risk_score, isCurrency: false)
                    }
                }

                CardSurface(title: "Top Positions", subtitle: "Allocation") {
                    ForEach(viewModel.portfolio.top_positions) { position in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(position.symbol)
                                    .font(.headline)
                                Text(position.asset_class)
                                    .font(.caption)
                                    .foregroundStyle(ImperiumPalette.muted)
                            }
                            Spacer()
                            Text(position.market_value, format: .currency(code: "USD"))
                                .font(.subheadline)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 36)
        }
        .background(ImperiumPalette.black.ignoresSafeArea())
    }
}

private struct BusinessTabView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CardSurface(title: "Business Command", subtitle: viewModel.business.entity_name) {
                    VStack(alignment: .leading, spacing: 10) {
                        MetricStrip(label: "MRR", value: viewModel.business.mrr, isCurrency: true)
                        MetricStrip(label: "Burn", value: viewModel.business.burn, isCurrency: true)
                        MetricStrip(label: "Runway (months)", value: viewModel.business.runway_months, isCurrency: false)
                        MetricStrip(label: "Cash", value: viewModel.business.cash_balance, isCurrency: true)
                        MetricStrip(label: "Overdue Invoices", value: Double(viewModel.business.overdue_invoices), isCurrency: false)
                    }
                }

                CardSurface(title: "Anomaly Rail", subtitle: "Operator alerts") {
                    ForEach(viewModel.businessAnomalies) { anomaly in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(anomaly.metric_key)
                                    .font(.headline)
                                Spacer()
                                Text(anomaly.severity.uppercased())
                                    .font(.caption2)
                                    .foregroundStyle(anomaly.severity.lowercased() == "high" ? ImperiumPalette.burgundy : ImperiumPalette.gold)
                            }
                            Text(anomaly.message)
                                .font(.subheadline)
                                .foregroundStyle(ImperiumPalette.text)
                            Text(anomaly.recommended_action)
                                .font(.caption)
                                .foregroundStyle(ImperiumPalette.muted)
                        }
                        .padding(10)
                        .background(ImperiumPalette.steel.opacity(0.45))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 36)
        }
        .background(ImperiumPalette.black.ignoresSafeArea())
    }
}

private struct IntelligenceTabView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel
    @State private var selectedClusterKey: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                CardSurface(title: "Narrative Clusters", subtitle: "Curated") {
                    ForEach(viewModel.clusters) { cluster in
                        Button {
                            selectedClusterKey = cluster.cluster_key
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(cluster.title)
                                        .font(.headline)
                                        .foregroundStyle(ImperiumPalette.text)
                                    Text("\(cluster.article_count) sources")
                                        .font(.caption)
                                        .foregroundStyle(ImperiumPalette.muted)
                                }
                                Spacer()
                                Text(cluster.impact_score, format: .number.precision(.fractionLength(2)))
                                    .font(.caption)
                                    .foregroundStyle(ImperiumPalette.gold)
                            }
                            .padding(10)
                            .background(selectedClusterKey == cluster.cluster_key ? ImperiumPalette.forest.opacity(0.35) : ImperiumPalette.steel.opacity(0.45))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }

                CardSurface(title: "Intelligence Inbox", subtitle: "Impact ranked") {
                    ForEach(viewModel.inbox) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(item.title)
                                    .font(.headline)
                                Spacer()
                                Text("\(item.impact_score, specifier: "%.2f")")
                                    .font(.caption)
                                    .foregroundStyle(ImperiumPalette.gold)
                            }
                            Text(item.summary)
                                .font(.subheadline)
                                .foregroundStyle(ImperiumPalette.text)
                                .lineLimit(3)
                            Link("Source", destination: URL(string: item.canonical_url) ?? URL(string: "https://example.com")!)
                                .font(.caption)
                        }
                        .padding(10)
                        .background(ImperiumPalette.steel.opacity(0.45))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }

                CardSurface(title: "Reading Room", subtitle: "Parchment mode") {
                    if let selected = selectedItem {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(selected.title)
                                .font(.system(size: 21, weight: .semibold, design: .serif))
                                .foregroundStyle(Color(red: 0.30, green: 0.22, blue: 0.09))
                            Text(selected.summary)
                                .font(.subheadline)
                                .foregroundStyle(Color(red: 0.24, green: 0.20, blue: 0.13))
                            Text("Impact \(selected.impact_score, specifier: "%.2f")")
                                .font(.caption)
                                .foregroundStyle(Color(red: 0.38, green: 0.30, blue: 0.17))
                            Link("Open primary source", destination: URL(string: selected.canonical_url) ?? URL(string: "https://example.com")!)
                                .font(.caption)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(red: 0.95, green: 0.92, blue: 0.84))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    } else {
                        Text("Select a narrative cluster to focus your reading pass.")
                            .font(.subheadline)
                            .foregroundStyle(ImperiumPalette.muted)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 96)
            .padding(.bottom, 36)
        }
        .background(ImperiumPalette.black.ignoresSafeArea())
        .onAppear {
            if selectedClusterKey == nil {
                selectedClusterKey = viewModel.clusters.first?.cluster_key ?? viewModel.inbox.first?.cluster_key
            }
        }
        .onReceive(viewModel.$clusters) { clusters in
            let exists = clusters.contains(where: { $0.cluster_key == selectedClusterKey })
            if !exists {
                selectedClusterKey = clusters.first?.cluster_key
            }
        }
    }

    private var selectedItem: InboxItemResponse? {
        if let selectedClusterKey {
            return viewModel.inbox.first(where: { $0.cluster_key == selectedClusterKey })
        }
        return viewModel.inbox.first
    }
}

private struct ContextPanelView: View {
    @ObservedObject var viewModel: ImperiumMobileViewModel

    var body: some View {
        NavigationStack {
            List {
                Section("Priority Alerts") {
                    ForEach(viewModel.alerts.prefix(10)) { alert in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(alert.title)
                                .font(.headline)
                            Text(alert.why_it_matters)
                                .font(.subheadline)
                                .foregroundStyle(ImperiumPalette.text)
                            Text(alert.what_to_watch_next)
                                .font(.caption)
                                .foregroundStyle(ImperiumPalette.muted)
                        }
                    }
                }

                Section("Quick Actions") {
                    Text("If VIX spikes > 2 points, reduce speculative risk by 20%.")
                    Text("If cash runway drops below 4 months, freeze discretionary spend.")
                    Text("Before investor calls, re-read top 3 intelligence clusters.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(ImperiumPalette.black)
            .navigationTitle("Context AI")
        }
    }
}

private struct CardSurface<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.system(size: 20, weight: .semibold, design: .serif))
                    .foregroundStyle(ImperiumPalette.gold)
                Spacer()
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(ImperiumPalette.muted)
            }
            content()
        }
        .padding(14)
        .background(ImperiumPalette.charcoal.opacity(0.92))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ImperiumPalette.steel, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct MetricStrip: View {
    let label: String
    let value: Double
    let isCurrency: Bool

    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(ImperiumPalette.muted)
            Spacer()
            if isCurrency {
                Text(value, format: .currency(code: "USD"))
                    .foregroundStyle(ImperiumPalette.text)
            } else {
                Text(value, format: .number.precision(.fractionLength(1)))
                    .foregroundStyle(ImperiumPalette.text)
            }
        }
        .font(.subheadline)
        .padding(8)
        .background(ImperiumPalette.steel.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct UIKitChartPlaceholder: UIViewRepresentable {
    let candles: [CandlePoint]

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = UIColor(red: 0.09, green: 0.09, blue: 0.09, alpha: 1)

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "UIKit Chart Bridge"
        label.textColor = UIColor(red: 0.70, green: 0.65, blue: 0.56, alpha: 1)
        label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        view.addSubview(label)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            label.topAnchor.constraint(equalTo: view.topAnchor, constant: 10)
        ])

        let layer = CAShapeLayer()
        layer.strokeColor = UIColor(red: 0.73, green: 0.60, blue: 0.38, alpha: 1).cgColor
        layer.fillColor = UIColor.clear.cgColor
        layer.lineWidth = 2
        layer.name = "sparkline"
        view.layer.addSublayer(layer)

        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        let width = uiView.bounds.width
        let height = uiView.bounds.height
        guard width > 10, height > 10 else { return }

        let points = candles
        guard points.count > 1 else { return }

        let closes = points.map { $0.close }
        let minValue = closes.min() ?? 0
        let maxValue = closes.max() ?? 1
        let spread = max(maxValue - minValue, 0.0001)

        let path = UIBezierPath()
        for (index, candle) in points.enumerated() {
            let x = CGFloat(index) / CGFloat(points.count - 1) * (width - 16) + 8
            let normalized = (candle.close - minValue) / spread
            let y = (height - 20) - CGFloat(normalized) * (height - 40)
            let point = CGPoint(x: x, y: y)
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }

        if let layer = uiView.layer.sublayers?.first(where: { $0.name == "sparkline" }) as? CAShapeLayer {
            layer.path = path.cgPath
        }
    }
}

private struct BriefResponse: Codable {
    let brief_date: String
    let generated_at: String
    let required_reads: [String]
    let sections: [BriefSection]

    static let fallback = BriefResponse(
        brief_date: "2026-02-16",
        generated_at: "2026-02-16T05:00:00Z",
        required_reads: [
            "US yields rose overnight on hawkish rate repricing",
            "Semiconductor supply narrative tightened across major press",
            "Monitor payroll revisions before increasing cyclicals"
        ],
        sections: [
            BriefSection(
                section_key: "market_snapshot",
                title: "Global Market Snapshot",
                summary: "Risk sentiment is mixed with equity momentum intact and rates elevated.",
                claims: [
                    BriefClaim(
                        statement: "Nasdaq futures held trend support into Europe open.",
                        impact_score: 0.72,
                        confidence_score: 0.81,
                        citations: [
                            BriefCitation(source_url: "https://example.com/nasdaq-futures", source_snippet: "Futures maintained overnight support into Europe cash open.")
                        ],
                        recommended_action: "Track opening breadth before increasing exposure."
                    ),
                    BriefClaim(
                        statement: "2Y Treasury repriced hawkishly after stronger labor revisions.",
                        impact_score: 0.69,
                        confidence_score: 0.79,
                        citations: [
                            BriefCitation(source_url: "https://example.com/us2y", source_snippet: "US 2Y yields climbed after revised labor data prints.")
                        ],
                        recommended_action: "Reduce duration-sensitive risk if yields extend."
                    )
                ]
            ),
            BriefSection(
                section_key: "tactical_levels",
                title: "Tactical Levels",
                summary: "Define if/then responses before New York open.",
                claims: [
                    BriefClaim(
                        statement: "If NVDA reclaims prior high on volume, maintain risk-on allocation.",
                        impact_score: 0.74,
                        confidence_score: 0.78,
                        citations: [
                            BriefCitation(source_url: "https://example.com/nvda-levels", source_snippet: "Momentum re-acceleration level is near prior intraday high.")
                        ],
                        recommended_action: "Respect stop discipline if level fails."
                    ),
                    BriefClaim(
                        statement: "If DXY breaks higher, reduce non-USD growth risk by 10%.",
                        impact_score: 0.66,
                        confidence_score: 0.75,
                        citations: [
                            BriefCitation(source_url: "https://example.com/dxy", source_snippet: "Dollar breakout pressure persisted across Europe session.")
                        ],
                        recommended_action: "Tighten FX-sensitive allocations."
                    )
                ]
            )
        ]
    )
}

private struct BriefSection: Codable, Identifiable {
    let section_key: String
    let title: String
    let summary: String
    let claims: [BriefClaim]

    var id: String { section_key }
}

private struct BriefClaim: Codable, Identifiable {
    let statement: String
    let impact_score: Double
    let confidence_score: Double
    let citations: [BriefCitation]
    let recommended_action: String?

    var id: String { "\(statement)-\(impact_score)" }
}

private struct BriefCitation: Codable, Identifiable {
    let source_url: String
    let source_snippet: String

    var id: String { "\(source_url)-\(source_snippet)" }
}

private struct WatchlistEntry: Decodable {
    let symbol: String
    let label: String
}

private struct QuoteResponse: Decodable {
    let symbol: String
    let price: Double
    let change_percent: Double
    let timestamp: String
}

private struct CandleResponse: Decodable {
    let close: Double
    let end_time: String
}

private struct WatchlistQuote: Codable, Identifiable {
    let symbol: String
    let label: String
    let price: Double
    let changePercent: Double
    let timestamp: String

    var id: String { symbol }

    var changePercentText: String {
        String(format: "%+.2f%%", changePercent)
    }

    static let fallback: [WatchlistQuote] = [
        WatchlistQuote(symbol: "SPY", label: "Core", price: 514.2, changePercent: 0.8, timestamp: "2026-02-16T10:42:00Z"),
        WatchlistQuote(symbol: "QQQ", label: "Core", price: 448.7, changePercent: 1.1, timestamp: "2026-02-16T10:42:00Z"),
        WatchlistQuote(symbol: "NVDA", label: "Earnings", price: 842.6, changePercent: -0.4, timestamp: "2026-02-16T10:42:00Z"),
        WatchlistQuote(symbol: "BTCUSD", label: "Macro Hedge", price: 68732, changePercent: 1.7, timestamp: "2026-02-16T10:42:00Z")
    ]
}

private struct CandlePoint: Codable {
    let close: Double
    let timestamp: String

    static let fallback: [CandlePoint] = [
        CandlePoint(close: 500, timestamp: "T1"),
        CandlePoint(close: 504, timestamp: "T2"),
        CandlePoint(close: 503, timestamp: "T3"),
        CandlePoint(close: 508, timestamp: "T4"),
        CandlePoint(close: 511, timestamp: "T5"),
        CandlePoint(close: 509, timestamp: "T6")
    ]
}

private struct PortfolioOverviewResponse: Decodable {
    let as_of: String
    let net_worth: Double
    let daily_change: Double
    let ytd_change: Double
    let risk_score: Double
    let top_positions: [PortfolioPosition]

    static let fallback = PortfolioOverviewResponse(
        as_of: "2026-02-16T10:40:00Z",
        net_worth: 7_420_500,
        daily_change: 83_200,
        ytd_change: 612_400,
        risk_score: 42.0,
        top_positions: [
            PortfolioPosition(symbol: "NVDA", market_value: 1_980_000, asset_class: "equity"),
            PortfolioPosition(symbol: "MSFT", market_value: 1_430_000, asset_class: "equity"),
            PortfolioPosition(symbol: "BTC", market_value: 820_000, asset_class: "crypto")
        ]
    )
}

private struct PortfolioPosition: Decodable, Identifiable {
    let symbol: String
    let market_value: Double
    let asset_class: String

    var id: String { symbol }
}

private struct BusinessOverviewResponse: Decodable {
    let entity_name: String
    let mrr: Double
    let burn: Double
    let runway_months: Double
    let cash_balance: Double
    let overdue_invoices: Int

    static let fallback = BusinessOverviewResponse(
        entity_name: "Imperium Holdings",
        mrr: 412_000,
        burn: 173_000,
        runway_months: 18.4,
        cash_balance: 3_290_000,
        overdue_invoices: 2
    )
}

private struct BusinessAnomalyResponse: Decodable, Identifiable {
    let metric_key: String
    let severity: String
    let message: String
    let recommended_action: String

    var id: String { "\(metric_key)-\(message)" }

    static let fallback: [BusinessAnomalyResponse] = [
        BusinessAnomalyResponse(metric_key: "refund_rate", severity: "medium", message: "Refund ratio climbed above 3-day baseline.", recommended_action: "Audit refund reasons before week close."),
        BusinessAnomalyResponse(metric_key: "subscription_spend", severity: "high", message: "Tooling subscriptions spiked 18% WoW.", recommended_action: "Pause non-critical seats and review annual plans.")
    ]
}

private struct InboxItemResponse: Decodable, Identifiable {
    let cluster_key: String
    let title: String
    let summary: String
    let impact_score: Double
    let canonical_url: String

    var id: String { cluster_key }

    static let fallback: [InboxItemResponse] = [
        InboxItemResponse(cluster_key: "rates_001", title: "Fed guidance hardens", summary: "Multiple Fed speakers pushed back on near-term cuts.", impact_score: 0.82, canonical_url: "https://example.com/fed"),
        InboxItemResponse(cluster_key: "chips_001", title: "Chip lead times tighten", summary: "Supply chain pressure returned in advanced packaging.", impact_score: 0.74, canonical_url: "https://example.com/chips"),
        InboxItemResponse(cluster_key: "ai_reg_001", title: "AI regulation drafts expand", summary: "Draft framework broadens disclosure scope for model vendors.", impact_score: 0.67, canonical_url: "https://example.com/ai-reg")
    ]
}

private struct StoryClusterResponse: Decodable, Identifiable {
    let cluster_key: String
    let title: String
    let article_count: Int
    let impact_score: Double

    var id: String { cluster_key }

    static let fallback: [StoryClusterResponse] = [
        StoryClusterResponse(cluster_key: "macro_rates", title: "Rates repricing narrative", article_count: 7, impact_score: 0.82),
        StoryClusterResponse(cluster_key: "ai_supply", title: "AI compute and chip supply", article_count: 5, impact_score: 0.74),
        StoryClusterResponse(cluster_key: "regulation", title: "AI regulation and disclosure", article_count: 4, impact_score: 0.67)
    ]
}

private struct AlertEventResponse: Decodable, Identifiable {
    let alert_id: String
    let category: String
    let title: String
    let why_it_matters: String
    let what_to_watch_next: String

    var id: String { alert_id }

    static let fallback: [AlertEventResponse] = [
        AlertEventResponse(alert_id: "a1", category: "market", title: "NVDA volatility expansion", why_it_matters: "Your largest equity position widened intraday range.", what_to_watch_next: "Watch 5m close above prior high with volume."),
        AlertEventResponse(alert_id: "a2", category: "business", title: "Runway threshold approaching", why_it_matters: "Forecast runway moved below internal guardrail by 0.6 months.", what_to_watch_next: "Review discretionary spend and receivables timing."),
        AlertEventResponse(alert_id: "a3", category: "macro", title: "Rates repricing", why_it_matters: "Short-end yields are repricing hawkishly.", what_to_watch_next: "Monitor DXY and growth duration exposure.")
    ]
}

#if DEBUG
struct DashboardView_Previews: PreviewProvider {
    static var previews: some View {
        DashboardView()
    }
}
#endif
