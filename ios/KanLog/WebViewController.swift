import UIKit
import WebKit

/// Runs the bundled web app and supplies what a browser normally provides:
/// file saving (via the share sheet), alert/confirm dialogs, camera
/// permission and opening external links in Safari.
final class WebViewController: UIViewController {
    private var webView: WKWebView!
    private var downloads: [WKDownload: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        // Matches the web app's background so the status bar area blends in.
        view.backgroundColor = UIColor(red: 0xF7 / 255, green: 0xF5 / 255, blue: 0xED / 255, alpha: 1)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true // camera preview uses <video playsinline>
        config.mediaTypesRequiringUserActionForPlayback = []
        if let root = Bundle.main.url(forResource: "beer-save", withExtension: nil) {
            config.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: BundleSchemeHandler.scheme)
        }
        // In-app updates come from the App Store, so hide the web version's
        // update check and notice.
        let hideUpdates = WKUserScript(
            source: """
            const style = document.createElement('style');
            style.textContent = '.updateCard, #updateHomeNotice, #updateDot { display: none !important; }';
            document.documentElement.appendChild(style);
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(hideUpdates)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true } // Safari > Develop
        #endif

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor), // CSS handles the home indicator
        ])
        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url)
    }

    private func share(_ file: URL) {
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // <a download> (JSON/CSV backups) becomes a WKDownload.
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        switch url.scheme {
        case BundleSchemeHandler.scheme, "blob", "about", "data":
            decisionHandler(.allow)
        default:
            openExternally(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // The web content process can be killed in the background; reload it.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

extension WebViewController: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let destination = folder.appendingPathComponent(suggestedFilename)
        downloads[download] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: download) else { return }
        share(file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: download)
        let alert = UIAlertController(title: "保存できませんでした", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // target="_blank" links open in Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { openExternally(url) }
        return nil
    }

    // The system camera prompt (NSCameraUsageDescription) is shown once;
    // don't ask a second time for the bundled page.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == BundleSchemeHandler.scheme ? .grant : .prompt)
    }
}
