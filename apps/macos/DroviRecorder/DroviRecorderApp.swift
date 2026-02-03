import SwiftUI

@main
struct DroviRecorderApp: App {
    var body: some Scene {
        MenuBarExtra("Drovi", systemImage: "mic.fill") {
            RecordingView()
        }
        WindowGroup {
            RecordingView()
        }
    }
}
