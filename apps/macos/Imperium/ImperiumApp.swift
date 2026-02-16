import SwiftUI

@main
struct ImperiumApp: App {
    @StateObject private var workspace = ImperiumDesktopWorkspace()

    var body: some Scene {
        WindowGroup {
            CommandCenterView(workspace: workspace)
        }
        WindowGroup("Imperium Alerts", id: "imperium-alerts") {
            NotificationDrawerView(workspace: workspace)
                .frame(minWidth: 440, minHeight: 380)
        }
        .commands {
            CommandMenu("Imperium Modules") {
                Button("Daily Brief") { workspace.select(.brief) }
                    .keyboardShortcut("1", modifiers: [.command])
                Button("Markets") { workspace.select(.markets) }
                    .keyboardShortcut("2", modifiers: [.command])
                Button("Portfolio") { workspace.select(.portfolio) }
                    .keyboardShortcut("3", modifiers: [.command])
                Button("Business") { workspace.select(.business) }
                    .keyboardShortcut("4", modifiers: [.command])
                Button("Intelligence") { workspace.select(.intelligence) }
                    .keyboardShortcut("5", modifiers: [.command])
                Button("Risk + Regime") { workspace.select(.risk) }
                    .keyboardShortcut("6", modifiers: [.command])
                Button("Journal") { workspace.select(.journal) }
                    .keyboardShortcut("7", modifiers: [.command])

                Divider()

                Button("Command Bar") {
                    workspace.commandBarPresented = true
                }
                .keyboardShortcut("k", modifiers: [.command])

                Button("Alert Drawer") {
                    workspace.notificationDrawerPresented = true
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }
        }
    }
}
