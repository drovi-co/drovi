import Foundation
import SwiftUI

@MainActor
final class RecordingViewModel: ObservableObject {
    @Published var isRecording = false
    @Published var statusText = "Idle"

    private let audioRecorder = AudioRecorder()
    private var sessionId: String?
    private var uploadTimer: Timer?
    private let segmentInterval: TimeInterval = 10
    private var segmentIndex = 0

    func start(consent: Bool) {
        statusText = "Starting..."
        DroviNetworkClient.shared.startSession(sessionType: "meeting", title: nil, consentProvided: consent) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let id):
                    self.sessionId = id
                    do {
                        try self.audioRecorder.startRecording()
                        self.isRecording = true
                        self.statusText = "Recording"
                        self.segmentIndex = 0
                        self.startSegmentTimer()
                    } catch {
                        self.statusText = "Audio error"
                    }
                case .failure:
                    self.statusText = "Start failed"
                }
            }
        }
    }

    func stop() {
        guard let sessionId = sessionId else {
            statusText = "No session"
            return
        }

        uploadTimer?.invalidate()
        uploadTimer = nil

        if let fileURL = audioRecorder.stopSegment() {
            DroviNetworkClient.shared.uploadAudio(sessionId: sessionId, fileURL: fileURL, chunkIndex: segmentIndex) { _ in }
            segmentIndex += 1
        }

        audioRecorder.stopRecording()
        isRecording = false
        statusText = "Uploading..."

        self.statusText = "Finalizing..."
        DroviNetworkClient.shared.endSession(sessionId: sessionId) { endResult in
            DispatchQueue.main.async {
                switch endResult {
                case .success:
                    self.statusText = "Done"
                case .failure:
                    self.statusText = "End failed"
                }
            }
        }
    }

    private func startSegmentTimer() {
        uploadTimer?.invalidate()
        uploadTimer = Timer.scheduledTimer(withTimeInterval: segmentInterval, repeats: true) { _ in
            guard let sessionId = self.sessionId else { return }
            if let fileURL = self.audioRecorder.stopSegment() {
                DroviNetworkClient.shared.uploadAudio(sessionId: sessionId, fileURL: fileURL, chunkIndex: self.segmentIndex) { _ in }
                self.segmentIndex += 1
                try? self.audioRecorder.startNewSegment()
            }
        }
    }
}
