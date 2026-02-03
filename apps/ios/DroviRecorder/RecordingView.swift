import SwiftUI

struct RecordingView: View {
    @StateObject private var viewModel = RecordingViewModel()
    @State private var consentGiven = false

    var body: some View {
        VStack(spacing: 24) {
            Text("Drovi Recorder")
                .font(.title2)
                .fontWeight(.semibold)

            Text(viewModel.statusText)
                .font(.subheadline)
                .foregroundColor(.secondary)

            Toggle("Consent confirmed", isOn: $consentGiven)

            Button(viewModel.isRecording ? "Stop" : "Record") {
                if viewModel.isRecording {
                    viewModel.stop()
                } else {
                    viewModel.start(consent: consentGiven)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!viewModel.isRecording && !consentGiven)
        }
        .padding(24)
    }
}
