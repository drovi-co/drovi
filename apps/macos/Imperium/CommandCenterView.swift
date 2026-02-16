import SwiftUI

struct CommandCenterView: View {
    private let modules = [
        "Daily Brief",
        "Markets",
        "Portfolio",
        "Business",
        "Intelligence",
        "Risk",
        "Journal"
    ]

    var body: some View {
        NavigationSplitView {
            List(modules, id: \.self) { module in
                Text(module)
            }
            .navigationTitle("Imperium")
        } content: {
            Text("Select a module")
                .font(.title2)
        } detail: {
            Text("Phase 1 scaffold: module detail panel")
                .foregroundStyle(.secondary)
        }
    }
}

#Preview {
    CommandCenterView()
}
