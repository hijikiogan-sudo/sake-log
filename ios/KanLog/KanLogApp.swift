import SwiftUI

@main
struct KanLogApp: App {
    var body: some Scene {
        WindowGroup {
            WebAppView()
                .ignoresSafeArea()
        }
    }
}

/// Hosts the bundled web app (beer-save) in a WKWebView.
struct WebAppView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}
