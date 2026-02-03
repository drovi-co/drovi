import AVFoundation
import Foundation

final class AudioRecorder: NSObject {
    private var recorder: AVAudioRecorder?
    private(set) var fileURL: URL?

    func startRecording() throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)

        let tempURL = try createNewSegmentURL()
        recorder = try AVAudioRecorder(url: tempURL, settings: settings)
        recorder?.prepareToRecord()
        recorder?.record()
    }

    func stopSegment() -> URL? {
        recorder?.stop()
        let url = fileURL
        recorder = nil
        return url
    }

    func startNewSegment() throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        let tempURL = try createNewSegmentURL()
        recorder = try AVAudioRecorder(url: tempURL, settings: settings)
        recorder?.prepareToRecord()
        recorder?.record()
    }

    func stopRecording() {
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    private func createNewSegmentURL() throws -> URL {
        let filename = "drovi-recording-\(UUID().uuidString).m4a"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        fileURL = tempURL
        return tempURL
    }
}
