import SwiftUI

struct DashboardView: View {
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
        NavigationStack {
            List(modules, id: \.self) { module in
                VStack(alignment: .leading, spacing: 6) {
                    Text(module)
                        .font(.headline)
                    Text("Scaffold ready for Phase 2 feature wiring")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Imperium")
        }
    }
}

#Preview {
    DashboardView()
}
