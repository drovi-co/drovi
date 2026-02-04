import Foundation

// Placeholder for macOS native context capture.
// TODO: Implement Accessibility API hooks and ScreenCaptureKit pipeline.

@objc public class ContextCapture: NSObject {
    @objc public func activeContext() -> [String: Any] {
        return [
            "status": "not_implemented",
            "message": "Context capture module pending Swift implementation."
        ]
    }
}
