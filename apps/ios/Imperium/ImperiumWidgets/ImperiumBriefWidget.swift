import WidgetKit
import SwiftUI

private struct ImperiumBriefEntry: TimelineEntry {
    let date: Date
    let headline: String
    let summary: String
    let deepLink: URL
}

private struct ImperiumBriefProvider: TimelineProvider {
    func placeholder(in context: Context) -> ImperiumBriefEntry {
        entry()
    }

    func getSnapshot(in context: Context, completion: @escaping (ImperiumBriefEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ImperiumBriefEntry>) -> Void) {
        let current = Date()
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: current) ?? current.addingTimeInterval(1800)
        let timeline = Timeline(entries: [entry(date: current)], policy: .after(next))
        completion(timeline)
    }

    private func entry(date: Date = Date()) -> ImperiumBriefEntry {
        ImperiumBriefEntry(
            date: date,
            headline: "05:00 Strategic Brief",
            summary: "Risk mixed. Rates firm. Review tactical levels before open.",
            deepLink: URL(string: "imperium://brief") ?? URL(string: "https://example.com")!
        )
    }
}

private struct ImperiumBriefWidgetView: View {
    var entry: ImperiumBriefProvider.Entry

    var body: some View {
        Link(destination: entry.deepLink) {
            VStack(alignment: .leading, spacing: 6) {
                Text("IMPERIUM")
                    .font(.system(size: 10, weight: .bold, design: .serif))
                    .foregroundStyle(Color(red: 0.73, green: 0.60, blue: 0.38))
                Text(entry.headline)
                    .font(.system(size: 14, weight: .semibold, design: .serif))
                    .foregroundStyle(Color(red: 0.94, green: 0.91, blue: 0.83))
                    .lineLimit(2)
                Text(entry.summary)
                    .font(.system(size: 11, weight: .regular, design: .default))
                    .foregroundStyle(Color(red: 0.72, green: 0.66, blue: 0.56))
                    .lineLimit(3)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(10)
            .background(Color(red: 0.07, green: 0.07, blue: 0.07))
        }
    }
}

private struct ImperiumBriefWidget: Widget {
    let kind = "ImperiumBriefWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ImperiumBriefProvider()) { entry in
            ImperiumBriefWidgetView(entry: entry)
        }
        .configurationDisplayName("Imperium Brief")
        .description("Quick 05:00 summary and one-tap deep link into Imperium.")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct ImperiumWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ImperiumBriefWidget()
    }
}
