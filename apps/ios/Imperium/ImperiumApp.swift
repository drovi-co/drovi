import SwiftUI
import UserNotifications
import UIKit

@main
struct ImperiumApp: App {
    @UIApplicationDelegateAdaptor(ImperiumAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            DashboardView()
        }
    }
}

final class ImperiumAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }

        guard let raw = response.notification.request.content.userInfo["deep_link"] as? String,
              let url = URL(string: raw)
        else {
            return
        }

        NotificationCenter.default.post(name: .imperiumDeepLink, object: url)
    }
}

extension Notification.Name {
    static let imperiumDeepLink = Notification.Name("imperium.deeplink")
}
