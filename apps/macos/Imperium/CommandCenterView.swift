import SwiftUI
import UniformTypeIdentifiers

struct CommandCenterView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        NavigationSplitView {
            SidebarView(workspace: workspace)
                .navigationTitle("Imperium")
        } content: {
            ModuleContentView(workspace: workspace)
        } detail: {
            ContextDetailView(workspace: workspace)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    Task { await workspace.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    workspace.commandBarPresented = true
                } label: {
                    Label("Command", systemImage: "command")
                }

                Button {
                    workspace.notificationDrawerPresented = true
                } label: {
                    Label("Alerts", systemImage: "bell")
                }
            }
        }
        .task {
            await workspace.refresh()
        }
        .sheet(isPresented: $workspace.commandBarPresented) {
            CommandBarSheet(workspace: workspace)
                .frame(minWidth: 540, minHeight: 380)
        }
        .sheet(isPresented: $workspace.notificationDrawerPresented) {
            NotificationDrawerView(workspace: workspace)
                .frame(minWidth: 460, minHeight: 420)
        }
        .onOpenURL { url in
            handleDeepLink(url)
        }
        .background(ImperiumMacPalette.black)
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
            workspace.select(.brief)
        case "markets":
            workspace.select(.markets)
        case "portfolio":
            workspace.select(.portfolio)
        case "business":
            workspace.select(.business)
        case "intelligence":
            workspace.select(.intelligence)
        case "risk":
            workspace.select(.risk)
        case "journal":
            workspace.select(.journal)
        case "alerts":
            workspace.notificationDrawerPresented = true
        default:
            break
        }
    }
}

@MainActor
final class ImperiumDesktopWorkspace: ObservableObject {
    @Published var activeModule: DesktopModule = .brief
    @Published var commandBarPresented = false
    @Published var notificationDrawerPresented = false

    @Published var brief: DesktopBriefResponse = .fallback
    @Published var watchlistQuotes: [DesktopWatchlistQuote] = DesktopWatchlistQuote.fallback
    @Published var candles: [DesktopCandlePoint] = DesktopCandlePoint.fallback
    @Published var portfolio: DesktopPortfolioOverview = .fallback
    @Published var business: DesktopBusinessOverview = .fallback
    @Published var inbox: [DesktopInboxItem] = DesktopInboxItem.fallback
    @Published var regime: DesktopRegimeState = .fallback
    @Published var riskSignals: [DesktopRiskSignal] = DesktopRiskSignal.fallback
    @Published var theses: [DesktopThesis] = DesktopThesis.fallback
    @Published var alerts: [DesktopAlertEvent] = DesktopAlertEvent.fallback
    @Published var alertRules: [DesktopAlertRule] = DesktopAlertRule.fallback
    @Published var streamContracts: [DesktopStreamContract] = DesktopStreamContract.fallback
    @Published var providerChecks: [DesktopProviderCheck] = DesktopProviderCheck.fallback
    @Published var syncLabel = "Bootstrapped"
    @Published var lastSync = Date()

    private let api = ImperiumDesktopAPI()

    func select(_ module: DesktopModule) {
        activeModule = module
    }

    func refresh() async {
        syncLabel = "Syncing"

        do {
            let brief = try await api.fetch(DesktopBriefResponse.self, path: "/api/v1/imperium/brief/today")
            let watchlist = try await api.fetch([DesktopWatchlistEntry].self, path: "/api/v1/imperium/markets/watchlist")
            let portfolio = try await api.fetch(DesktopPortfolioOverview.self, path: "/api/v1/imperium/portfolio/overview")
            let business = try await api.fetch(DesktopBusinessOverview.self, path: "/api/v1/imperium/business/overview")
            let inbox = try await api.fetch([DesktopInboxItem].self, path: "/api/v1/imperium/intelligence/inbox")
            let regime = try await api.fetch(DesktopRegimeState.self, path: "/api/v1/imperium/risk/regime")
            let riskSignals = try await api.fetch([DesktopRiskSignal].self, path: "/api/v1/imperium/risk/signals")
            let theses = try await api.fetch([DesktopThesis].self, path: "/api/v1/imperium/journal/theses")
            let alerts = try await api.fetch([DesktopAlertEvent].self, path: "/api/v1/imperium/alerts/feed")
            let alertRules = try await api.fetch([DesktopAlertRule].self, path: "/api/v1/imperium/alerts/rules")
            let streamContracts = try await api.fetch([DesktopStreamContract].self, path: "/api/v1/imperium/markets/stream/contracts")
            let health = try await api.fetch(DesktopProviderHealth.self, path: "/api/v1/imperium/providers/health")

            var quotes: [DesktopWatchlistQuote] = []
            for entry in watchlist.prefix(10) {
                if let quote = try? await api.fetch(DesktopQuoteResponse.self, path: "/api/v1/imperium/markets/\(entry.symbol)/quote") {
                    quotes.append(
                        DesktopWatchlistQuote(
                            symbol: quote.symbol,
                            label: entry.label,
                            price: quote.price,
                            changePercent: quote.change_percent,
                            timestamp: quote.timestamp
                        )
                    )
                }
            }

            let symbol = watchlist.first?.symbol ?? "SPY"
            let candleSeries = (try? await api.fetch([DesktopCandleResponse].self, path: "/api/v1/imperium/markets/\(symbol)/candles?interval=5m&limit=64")) ?? []

            self.brief = brief
            self.watchlistQuotes = quotes.isEmpty ? DesktopWatchlistQuote.fallback : quotes
            self.candles = candleSeries.map { DesktopCandlePoint(close: $0.close, timestamp: $0.end_time) }
            self.portfolio = portfolio
            self.business = business
            self.inbox = inbox
            self.regime = regime
            self.riskSignals = riskSignals
            self.theses = theses
            self.alerts = alerts
            self.alertRules = alertRules
            self.streamContracts = streamContracts
            self.providerChecks = health.checks
            self.syncLabel = "Live"
        } catch {
            syncLabel = "Degraded"
        }

        lastSync = Date()
    }
}

enum DesktopModule: String, CaseIterable, Identifiable {
    case brief
    case markets
    case portfolio
    case business
    case intelligence
    case risk
    case journal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .brief: return "Daily Brief"
        case .markets: return "Markets"
        case .portfolio: return "Portfolio"
        case .business: return "Business"
        case .intelligence: return "Intelligence"
        case .risk: return "Risk + Regime"
        case .journal: return "Journal"
        }
    }

    var subtitle: String {
        switch self {
        case .brief: return "05:00 strategic briefing"
        case .markets: return "Live cross-asset command"
        case .portfolio: return "Net worth and exposure"
        case .business: return "Revenue, burn, runway"
        case .intelligence: return "Ranked narrative clusters"
        case .risk: return "Regime and risk overlays"
        case .journal: return "Decision memory system"
        }
    }

    var shortcut: String {
        switch self {
        case .brief: return "1"
        case .markets: return "2"
        case .portfolio: return "3"
        case .business: return "4"
        case .intelligence: return "5"
        case .risk: return "6"
        case .journal: return "7"
        }
    }
}

private struct SidebarView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Imperium")
                    .font(.system(size: 14, weight: .bold, design: .serif))
                    .foregroundStyle(ImperiumMacPalette.gold)
                Text("Sovereign command station")
                    .font(.caption)
                    .foregroundStyle(ImperiumMacPalette.muted)
            }
            .padding(.bottom, 6)

            ForEach(DesktopModule.allCases) { module in
                Button {
                    workspace.select(module)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(module.title)
                                .font(.body)
                            Text(module.subtitle)
                                .font(.caption)
                                .foregroundStyle(ImperiumMacPalette.muted)
                        }
                        Spacer()
                        Text("\u{2318}\(module.shortcut)")
                            .font(.caption2)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(workspace.activeModule == module ? ImperiumMacPalette.steel : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(workspace.activeModule == module ? ImperiumMacPalette.gold : ImperiumMacPalette.border, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }

            Spacer()

            HStack {
                Text(workspace.syncLabel)
                    .font(.caption)
                    .foregroundStyle(workspace.syncLabel == "Live" ? ImperiumMacPalette.gold : ImperiumMacPalette.burgundy)
                Spacer()
                Text(workspace.lastSync.formatted(date: .omitted, time: .shortened))
                    .font(.caption2)
                    .foregroundStyle(ImperiumMacPalette.muted)
            }
        }
        .padding(14)
        .background(ImperiumMacPalette.black)
    }
}

private struct ModuleContentView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                switch workspace.activeModule {
                case .brief:
                    BriefModuleView(workspace: workspace)
                case .markets:
                    MarketsModuleView(workspace: workspace)
                case .portfolio:
                    PortfolioModuleView(workspace: workspace)
                case .business:
                    BusinessModuleView(workspace: workspace)
                case .intelligence:
                    IntelligenceModuleView(workspace: workspace)
                case .risk:
                    RiskModuleView(workspace: workspace)
                case .journal:
                    JournalModuleView(workspace: workspace)
                }
            }
            .padding(16)
        }
        .background(ImperiumMacPalette.black)
    }
}

private struct ContextDetailView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            InfoCard(title: "Provider Health", subtitle: "Live checks") {
                ForEach(workspace.providerChecks) { check in
                    HStack {
                        Text(check.domain)
                            .font(.subheadline)
                        Spacer()
                        Text(check.healthy ? "healthy" : "degraded")
                            .font(.caption)
                            .foregroundStyle(check.healthy ? ImperiumMacPalette.gold : ImperiumMacPalette.burgundy)
                    }
                    .padding(.vertical, 3)
                }
            }

            InfoCard(title: "Alert Rail", subtitle: "Actionable only") {
                ForEach(workspace.alerts.prefix(8)) { alert in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(alert.title)
                            .font(.subheadline.bold())
                        Text(alert.why_it_matters)
                            .font(.caption)
                            .foregroundStyle(ImperiumMacPalette.text)
                        Text(alert.what_to_watch_next)
                            .font(.caption2)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                    .padding(.vertical, 5)
                }
            }

            InfoCard(title: "Rulebook", subtitle: "Cooldown + thresholds") {
                ForEach(workspace.alertRules.prefix(6)) { rule in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(rule.name)
                            .font(.subheadline)
                        Text("\(rule.category) · threshold \(rule.threshold, specifier: "%.2f") · cooldown \(rule.cooldown_seconds)s")
                            .font(.caption2)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            InfoCard(title: "Realtime Contracts", subtitle: "SSE channels") {
                ForEach(workspace.streamContracts.prefix(4)) { contract in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(contract.channel)
                            .font(.subheadline)
                        Text(contract.subject)
                            .font(.caption2)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                    .padding(.vertical, 2)
                }
            }

            Spacer()
        }
        .padding(14)
        .background(ImperiumMacPalette.black)
    }
}

private struct BriefModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        InfoCard(title: "Strategic Brief", subtitle: workspace.brief.generated_at) {
            ForEach(workspace.brief.sections) { section in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(section.title)
                            .font(.headline)
                        Spacer()
                        Text("\(section.claims.count) claims")
                            .font(.caption)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                    Text(section.summary)
                        .font(.subheadline)
                    ForEach(section.claims) { claim in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(claim.statement)
                                .font(.footnote)
                            Text("Impact \(claim.impact_score, specifier: "%.2f") Confidence \(claim.confidence_score, specifier: "%.2f")")
                                .font(.caption2)
                                .foregroundStyle(ImperiumMacPalette.muted)
                        }
                        .padding(8)
                        .background(ImperiumMacPalette.steel.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(10)
                .background(ImperiumMacPalette.steel.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

private struct MarketsModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var showResearchMode = false
    @State private var researchSymbol = "SPY"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            InfoCard(title: "Candle Track", subtitle: "5m default") {
                SparklineView(values: workspace.candles.map { $0.close })
                    .frame(height: 220)
                HStack {
                    Picker("Ticker", selection: $researchSymbol) {
                        ForEach(workspace.watchlistQuotes) { quote in
                            Text(quote.symbol).tag(quote.symbol)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: 180)

                    Button(showResearchMode ? "Hide Research Mode" : "Open Research Mode") {
                        showResearchMode.toggle()
                    }
                    .buttonStyle(.bordered)
                }
            }

            InfoCard(title: "Watchlist", subtitle: "Trader density") {
                Table(workspace.watchlistQuotes) {
                    TableColumn("Symbol") { quote in
                        Text(quote.symbol)
                    }
                    TableColumn("Book") { quote in
                        Text(quote.label)
                    }
                    TableColumn("Price") { quote in
                        Text(quote.price, format: .currency(code: "USD"))
                    }
                    TableColumn("Change") { quote in
                        Text(quote.changePercent, format: .percent)
                            .foregroundStyle(quote.changePercent >= 0 ? ImperiumMacPalette.gold : ImperiumMacPalette.burgundy)
                    }
                }
                .frame(minHeight: 260)
            }

            if showResearchMode {
                InfoCard(title: "Research Mode", subtitle: researchSymbol) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Bull case")
                            .font(.headline)
                        Text("\(researchSymbol) remains in leadership with resilient estimate revisions.")
                            .font(.subheadline)
                        Text("Bear case")
                            .font(.headline)
                        Text("Positioning is crowded and valuation compression risk rises if rates grind up.")
                            .font(.subheadline)
                        Text("Catalysts this week")
                            .font(.headline)
                        Text("Macro prints, peer guidance updates, and options expiry flow.")
                            .font(.subheadline)
                    }
                }
            }
        }
    }
}

private struct PortfolioModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var showScenario = false

    var body: some View {
        InfoCard(title: "Portfolio", subtitle: workspace.portfolio.as_of) {
            MetricRow(title: "Net Worth", value: workspace.portfolio.net_worth, isCurrency: true)
            MetricRow(title: "Daily", value: workspace.portfolio.daily_change, isCurrency: true)
            MetricRow(title: "YTD", value: workspace.portfolio.ytd_change, isCurrency: true)
            MetricRow(title: "Risk Score", value: workspace.portfolio.risk_score, isCurrency: false)

            Divider().overlay(ImperiumMacPalette.border)

            ForEach(workspace.portfolio.top_positions) { position in
                HStack {
                    Text(position.symbol)
                    Spacer()
                    Text(position.asset_class)
                        .foregroundStyle(ImperiumMacPalette.muted)
                    Text(position.market_value, format: .currency(code: "USD"))
                }
                .font(.subheadline)
                .padding(.vertical, 3)
            }

            Button("Simulate Market -3%") {
                showScenario = true
            }
            .buttonStyle(.bordered)
            .padding(.top, 6)
        }
        .sheet(isPresented: $showScenario) {
            ScenarioSheet(portfolio: workspace.portfolio)
                .frame(minWidth: 420, minHeight: 260)
        }
    }
}

private struct BusinessModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var boardGeneratedAt: Date?
    @State private var boardDocument = BoardSnapshotDocument(text: "")
    @State private var exportPresented = false

    var body: some View {
        InfoCard(title: "Business Command", subtitle: workspace.business.entity_name) {
            MetricRow(title: "MRR", value: workspace.business.mrr, isCurrency: true)
            MetricRow(title: "Burn", value: workspace.business.burn, isCurrency: true)
            MetricRow(title: "Runway (months)", value: workspace.business.runway_months, isCurrency: false)
            MetricRow(title: "Cash", value: workspace.business.cash_balance, isCurrency: true)
            MetricRow(title: "Overdue Invoices", value: Double(workspace.business.overdue_invoices), isCurrency: false)

            Button("Generate Board Snapshot") {
                boardGeneratedAt = Date()
                boardDocument = BoardSnapshotDocument(text: boardSnapshotBody)
                exportPresented = true
            }
            .buttonStyle(.bordered)
            .fileExporter(
                isPresented: $exportPresented,
                document: boardDocument,
                contentType: .plainText,
                defaultFilename: "imperium-board-snapshot"
            ) { _ in }

            if let boardGeneratedAt {
                Text("Board snapshot prepared at \(boardGeneratedAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(ImperiumMacPalette.muted)
            }
        }
    }

    private var boardSnapshotBody: String {
        [
            "Entity: \(workspace.business.entity_name)",
            "MRR: \(workspace.business.mrr)",
            "Burn: \(workspace.business.burn)",
            "Runway months: \(workspace.business.runway_months)",
            "Cash balance: \(workspace.business.cash_balance)",
            "Overdue invoices: \(workspace.business.overdue_invoices)",
            "Generated at: \(Date().formatted(date: .numeric, time: .standard))"
        ].joined(separator: "\n")
    }
}

private struct IntelligenceModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var annotationStatus = "No annotation selected"

    var body: some View {
        InfoCard(title: "Intelligence Inbox", subtitle: "Impact ranked") {
            ForEach(workspace.inbox) { item in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(item.title)
                            .font(.headline)
                        Spacer()
                        Text(item.impact_score, format: .number.precision(.fractionLength(2)))
                            .font(.caption)
                            .foregroundStyle(ImperiumMacPalette.gold)
                    }
                    Text(item.summary)
                        .font(.subheadline)
                        .lineLimit(2)
                    Link("Source", destination: URL(string: item.canonical_url) ?? URL(string: "https://example.com")!)
                        .font(.caption)
                    HStack {
                        Button("Save to Thesis") {
                            annotationStatus = "Saved \"\(item.title)\" to thesis queue"
                        }
                        .buttonStyle(.bordered)
                        Button("Tag for Journal") {
                            annotationStatus = "Tagged \"\(item.title)\" for journal follow-up"
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(8)
                .background(ImperiumMacPalette.steel.opacity(0.3))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Text(annotationStatus)
                .font(.caption)
                .foregroundStyle(ImperiumMacPalette.muted)
        }
    }
}

private struct RiskModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var showPortfolioOverlay = false

    var body: some View {
        InfoCard(title: "Regime", subtitle: workspace.regime.updated_at) {
            Text(workspace.regime.regime.replacingOccurrences(of: "_", with: " "))
                .font(.title3.bold())
                .foregroundStyle(ImperiumMacPalette.gold)
            Text(workspace.regime.explanation)
                .font(.subheadline)
            Text("Confidence \(workspace.regime.confidence, specifier: "%.2f")")
                .font(.caption)
                .foregroundStyle(ImperiumMacPalette.muted)

            Divider().overlay(ImperiumMacPalette.border)

            ForEach(workspace.riskSignals) { signal in
                VStack(alignment: .leading, spacing: 3) {
                    Text(signal.key)
                        .font(.headline)
                    Text(signal.description)
                        .font(.caption)
                    Text(signal.severity)
                        .font(.caption2)
                        .foregroundStyle(ImperiumMacPalette.muted)
                }
                .padding(6)
                .background(ImperiumMacPalette.steel.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Toggle("Overlay portfolio impact context", isOn: $showPortfolioOverlay)
                .toggleStyle(.switch)

            if showPortfolioOverlay {
                Text("Overlay: concentration risk rises in current regime. Prioritize liquidity preservation.")
                    .font(.caption)
                    .foregroundStyle(ImperiumMacPalette.muted)
            }
        }
    }
}

private struct JournalModuleView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace

    var body: some View {
        InfoCard(title: "Decision Journal", subtitle: "Thesis memory") {
            ForEach(workspace.theses) { thesis in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(thesis.title)
                            .font(.headline)
                        Spacer()
                        Text("\(thesis.conviction_percent, specifier: "%.0f")%")
                            .font(.caption)
                            .foregroundStyle(ImperiumMacPalette.gold)
                    }
                    Text(thesis.rationale)
                        .font(.caption)
                    Text("Review \(thesis.review_date)")
                        .font(.caption2)
                        .foregroundStyle(ImperiumMacPalette.muted)
                    Text("Outcome tracking: pending reassessment")
                        .font(.caption2)
                        .foregroundStyle(ImperiumMacPalette.gold)
                }
                .padding(8)
                .background(ImperiumMacPalette.steel.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

private struct ScenarioSheet: View {
    let portfolio: DesktopPortfolioOverview
    @Environment(\.dismiss) private var dismiss

    private var estimatedLoss: Double {
        portfolio.net_worth * 0.03
    }

    private var liquidityImpact: Double {
        estimatedLoss * 0.4
    }

    private var hedgeNotional: Double {
        estimatedLoss * 1.2
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Scenario Simulation")
                .font(.title3.weight(.semibold))
                .foregroundStyle(ImperiumMacPalette.gold)
            Text("Input: Market drawdown -3%")
                .font(.subheadline)
                .foregroundStyle(ImperiumMacPalette.muted)

            MetricRow(title: "Estimated loss", value: estimatedLoss, isCurrency: true)
            MetricRow(title: "Liquidity impact", value: liquidityImpact, isCurrency: true)
            MetricRow(title: "Suggested hedge", value: hedgeNotional, isCurrency: true)

            HStack {
                Spacer()
                Button("Close") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(18)
        .background(ImperiumMacPalette.black)
    }
}

private struct CommandBarSheet: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField("Jump to module...", text: $query)
                .textFieldStyle(.roundedBorder)

            List(filteredModules) { module in
                Button {
                    workspace.activeModule = module
                    workspace.commandBarPresented = false
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(module.title)
                            Text(module.subtitle)
                                .font(.caption)
                                .foregroundStyle(ImperiumMacPalette.muted)
                        }
                        Spacer()
                        Text("\u{2318}\(module.shortcut)")
                            .font(.caption2)
                            .foregroundStyle(ImperiumMacPalette.muted)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(ImperiumMacPalette.black)
    }

    private var filteredModules: [DesktopModule] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty {
            return DesktopModule.allCases
        }

        return DesktopModule.allCases.filter {
            $0.title.lowercased().contains(needle) || $0.subtitle.lowercased().contains(needle)
        }
    }
}

struct NotificationDrawerView: View {
    @ObservedObject var workspace: ImperiumDesktopWorkspace
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Notification Drawer")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(ImperiumMacPalette.gold)
                Spacer()
                Button("Close") { dismiss() }
                    .buttonStyle(.bordered)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(workspace.alerts) { alert in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(alert.title)
                                .font(.headline)
                            Text(alert.why_it_matters)
                                .font(.subheadline)
                            Text(alert.what_to_watch_next)
                                .font(.caption)
                                .foregroundStyle(ImperiumMacPalette.muted)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(ImperiumMacPalette.steel.opacity(0.32))
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }
                }
            }
        }
        .padding(16)
        .background(ImperiumMacPalette.black)
    }
}

private struct BoardSnapshotDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }

    var text: String

    init(text: String) {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let decoded = String(data: data, encoding: .utf8)
        else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = decoded
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let data = Data(text.utf8)
        return .init(regularFileWithContents: data)
    }
}

private struct InfoCard<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.system(size: 20, weight: .semibold, design: .serif))
                    .foregroundStyle(ImperiumMacPalette.gold)
                Spacer()
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(ImperiumMacPalette.muted)
            }
            content()
        }
        .padding(12)
        .background(ImperiumMacPalette.charcoal)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ImperiumMacPalette.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

private struct MetricRow: View {
    let title: String
    let value: Double
    let isCurrency: Bool

    var body: some View {
        HStack {
            Text(title)
                .foregroundStyle(ImperiumMacPalette.muted)
            Spacer()
            if isCurrency {
                Text(value, format: .currency(code: "USD"))
            } else {
                Text(value, format: .number.precision(.fractionLength(1)))
            }
        }
        .font(.subheadline)
        .padding(8)
        .background(ImperiumMacPalette.steel.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct SparklineView: View {
    let values: [Double]

    var body: some View {
        GeometryReader { proxy in
            let points = normalizedPoints(in: proxy.size)

            Path { path in
                guard let first = points.first else { return }
                path.move(to: first)
                for point in points.dropFirst() {
                    path.addLine(to: point)
                }
            }
            .stroke(
                ImperiumMacPalette.gold,
                style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
            )
        }
        .padding(8)
        .background(ImperiumMacPalette.black)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func normalizedPoints(in size: CGSize) -> [CGPoint] {
        guard values.count > 1 else { return [] }
        let minValue = values.min() ?? 0
        let maxValue = values.max() ?? 1
        let spread = max(maxValue - minValue, 0.0001)

        return values.enumerated().map { index, value in
            let x = CGFloat(index) / CGFloat(values.count - 1) * max(size.width - 4, 1)
            let yRatio = (value - minValue) / spread
            let y = (size.height - 4) - CGFloat(yRatio) * max(size.height - 4, 1)
            return CGPoint(x: x + 2, y: y + 2)
        }
    }
}

private enum ImperiumMacPalette {
    static let black = Color(red: 0.05, green: 0.05, blue: 0.05)
    static let charcoal = Color(red: 0.10, green: 0.10, blue: 0.10)
    static let steel = Color(red: 0.15, green: 0.15, blue: 0.15)
    static let border = Color(red: 0.18, green: 0.18, blue: 0.18)
    static let gold = Color(red: 0.73, green: 0.60, blue: 0.38)
    static let burgundy = Color(red: 0.43, green: 0.18, blue: 0.23)
    static let text = Color(red: 0.92, green: 0.89, blue: 0.82)
    static let muted = Color(red: 0.70, green: 0.65, blue: 0.56)
}

private struct ImperiumDesktopAPI {
    func fetch<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        let url = Config.apiBaseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode)
        else {
            throw URLError(.badServerResponse)
        }

        return try JSONDecoder().decode(type, from: data)
    }
}

struct DesktopBriefResponse: Decodable {
    let generated_at: String
    let sections: [DesktopBriefSection]

    static let fallback = DesktopBriefResponse(
        generated_at: "2026-02-16T05:00:00Z",
        sections: [
            DesktopBriefSection(
                section_key: "market",
                title: "Global Market Overview",
                summary: "Risk is mixed with elevated rates and resilient growth leadership.",
                claims: [
                    DesktopBriefClaim(statement: "Nasdaq futures defended overnight support.", impact_score: 0.74, confidence_score: 0.81),
                    DesktopBriefClaim(statement: "Dollar strength remains a headwind for non-USD risk.", impact_score: 0.63, confidence_score: 0.76)
                ]
            )
        ]
    )
}

struct DesktopBriefSection: Decodable, Identifiable {
    let section_key: String
    let title: String
    let summary: String
    let claims: [DesktopBriefClaim]

    var id: String { section_key }
}

struct DesktopBriefClaim: Decodable, Identifiable {
    let statement: String
    let impact_score: Double
    let confidence_score: Double

    var id: String { "\(statement)-\(impact_score)" }
}

struct DesktopWatchlistEntry: Decodable {
    let symbol: String
    let label: String
}

struct DesktopQuoteResponse: Decodable {
    let symbol: String
    let price: Double
    let change_percent: Double
    let timestamp: String
}

struct DesktopCandleResponse: Decodable {
    let close: Double
    let end_time: String
}

struct DesktopWatchlistQuote: Identifiable {
    let symbol: String
    let label: String
    let price: Double
    let changePercent: Double
    let timestamp: String

    var id: String { symbol }

    static let fallback: [DesktopWatchlistQuote] = [
        DesktopWatchlistQuote(symbol: "SPY", label: "Core", price: 514.2, changePercent: 0.008, timestamp: ""),
        DesktopWatchlistQuote(symbol: "QQQ", label: "Core", price: 448.7, changePercent: 0.011, timestamp: ""),
        DesktopWatchlistQuote(symbol: "NVDA", label: "Earnings", price: 842.6, changePercent: -0.004, timestamp: "")
    ]
}

struct DesktopCandlePoint {
    let close: Double
    let timestamp: String

    static let fallback: [DesktopCandlePoint] = [
        DesktopCandlePoint(close: 500, timestamp: "T1"),
        DesktopCandlePoint(close: 504, timestamp: "T2"),
        DesktopCandlePoint(close: 501, timestamp: "T3"),
        DesktopCandlePoint(close: 506, timestamp: "T4"),
        DesktopCandlePoint(close: 510, timestamp: "T5")
    ]
}

struct DesktopPortfolioOverview: Decodable {
    let as_of: String
    let net_worth: Double
    let daily_change: Double
    let ytd_change: Double
    let risk_score: Double
    let top_positions: [DesktopPortfolioPosition]

    static let fallback = DesktopPortfolioOverview(
        as_of: "2026-02-16T10:40:00Z",
        net_worth: 7_420_500,
        daily_change: 83_200,
        ytd_change: 612_400,
        risk_score: 42,
        top_positions: [
            DesktopPortfolioPosition(symbol: "NVDA", market_value: 1_980_000, asset_class: "equity"),
            DesktopPortfolioPosition(symbol: "MSFT", market_value: 1_430_000, asset_class: "equity"),
            DesktopPortfolioPosition(symbol: "BTC", market_value: 820_000, asset_class: "crypto")
        ]
    )
}

struct DesktopPortfolioPosition: Decodable, Identifiable {
    let symbol: String
    let market_value: Double
    let asset_class: String

    var id: String { symbol }
}

struct DesktopBusinessOverview: Decodable {
    let entity_name: String
    let mrr: Double
    let burn: Double
    let runway_months: Double
    let cash_balance: Double
    let overdue_invoices: Int

    static let fallback = DesktopBusinessOverview(
        entity_name: "Imperium Holdings",
        mrr: 412_000,
        burn: 173_000,
        runway_months: 18.4,
        cash_balance: 3_290_000,
        overdue_invoices: 2
    )
}

struct DesktopInboxItem: Decodable, Identifiable {
    let cluster_key: String
    let title: String
    let summary: String
    let impact_score: Double
    let canonical_url: String

    var id: String { cluster_key }

    static let fallback: [DesktopInboxItem] = [
        DesktopInboxItem(cluster_key: "rates_001", title: "Fed guidance hardens", summary: "Speakers pushed back on near-term cuts.", impact_score: 0.82, canonical_url: "https://example.com/fed"),
        DesktopInboxItem(cluster_key: "chips_001", title: "Chip lead times tighten", summary: "Advanced packaging bottlenecks returned.", impact_score: 0.74, canonical_url: "https://example.com/chips")
    ]
}

struct DesktopRegimeState: Decodable {
    let regime: String
    let confidence: Double
    let explanation: String
    let updated_at: String

    static let fallback = DesktopRegimeState(
        regime: "risk_off",
        confidence: 0.73,
        explanation: "Rates and dollar momentum indicate tighter liquidity regime.",
        updated_at: "2026-02-16T10:35:00Z"
    )
}

struct DesktopRiskSignal: Decodable, Identifiable {
    let key: String
    let severity: String
    let description: String
    let created_at: String

    var id: String { "\(key)-\(created_at)" }

    static let fallback: [DesktopRiskSignal] = [
        DesktopRiskSignal(key: "concentration", severity: "high", description: "Top two holdings exceed 40% of portfolio.", created_at: "2026-02-16T10:10:00Z"),
        DesktopRiskSignal(key: "duration", severity: "medium", description: "Rate sensitivity increased after growth add-ons.", created_at: "2026-02-16T10:12:00Z")
    ]
}

struct DesktopThesis: Decodable, Identifiable {
    let thesis_id: String
    let title: String
    let conviction_percent: Double
    let rationale: String
    let review_date: String

    var id: String { thesis_id }

    static let fallback: [DesktopThesis] = [
        DesktopThesis(thesis_id: "t1", title: "AI infra cycle remains underpriced", conviction_percent: 72, rationale: "Demand remains constrained by supply and capex commitments are compounding.", review_date: "2026-03-01"),
        DesktopThesis(thesis_id: "t2", title: "Maintain USD hedge in risk-off regime", conviction_percent: 61, rationale: "Macro repricing path still favors dollar strength in shocks.", review_date: "2026-02-25")
    ]
}

struct DesktopAlertEvent: Decodable, Identifiable {
    let alert_id: String
    let title: String
    let why_it_matters: String
    let what_to_watch_next: String

    var id: String { alert_id }

    static let fallback: [DesktopAlertEvent] = [
        DesktopAlertEvent(alert_id: "a1", title: "NVDA volatility expansion", why_it_matters: "Largest position widened intraday range.", what_to_watch_next: "Watch 5m closes above prior high with volume."),
        DesktopAlertEvent(alert_id: "a2", title: "Runway threshold approaching", why_it_matters: "Forecast runway moved below internal guardrail.", what_to_watch_next: "Review discretionary spend and receivables timing.")
    ]
}

struct DesktopAlertRule: Decodable, Identifiable {
    let rule_id: String
    let category: String
    let name: String
    let threshold: Double
    let cooldown_seconds: Int
    let enabled: Bool

    var id: String { rule_id }

    static let fallback: [DesktopAlertRule] = [
        DesktopAlertRule(rule_id: "r1", category: "market", name: "NVDA break alert", threshold: 0.02, cooldown_seconds: 300, enabled: true),
        DesktopAlertRule(rule_id: "r2", category: "business", name: "Runway floor", threshold: 4.0, cooldown_seconds: 3600, enabled: true)
    ]
}

struct DesktopStreamContract: Decodable, Identifiable {
    let channel: String
    let subject: String
    let payload_schema: String

    var id: String { "\(channel)-\(subject)" }

    static let fallback: [DesktopStreamContract] = [
        DesktopStreamContract(channel: "market_ticks", subject: "imperium.market.tick", payload_schema: "MarketTick"),
        DesktopStreamContract(channel: "alert_events", subject: "imperium.alert.event", payload_schema: "AlertEvent")
    ]
}

struct DesktopProviderHealth: Decodable {
    let checks: [DesktopProviderCheck]
}

struct DesktopProviderCheck: Decodable, Identifiable {
    let domain: String
    let healthy: Bool

    var id: String { domain }

    static let fallback: [DesktopProviderCheck] = [
        DesktopProviderCheck(domain: "markets", healthy: true),
        DesktopProviderCheck(domain: "news", healthy: true),
        DesktopProviderCheck(domain: "banking", healthy: false)
    ]
}

#if DEBUG
struct CommandCenterView_Previews: PreviewProvider {
    static var previews: some View {
        CommandCenterView(workspace: ImperiumDesktopWorkspace())
    }
}
#endif
