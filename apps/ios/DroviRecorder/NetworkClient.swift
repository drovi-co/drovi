import Foundation

final class DroviNetworkClient {
    static let shared = DroviNetworkClient()

    private init() {}

    func startSession(sessionType: String, title: String?, consentProvided: Bool, completion: @escaping (Result<String, Error>) -> Void) {
        var request = URLRequest(url: DroviConfig.apiBaseURL.appendingPathComponent("ingest/live-session/start"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(DroviConfig.apiKey)", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "organization_id": DroviConfig.organizationId,
            "session_type": sessionType,
            "title": title ?? "iOS Recording",
            "metadata": ["client": "ios"],
            "consent_provided": consentProvided,
            "region": "US"
        ]

        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: request) { data, _, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sessionId = json["session_id"] as? String else {
                completion(.failure(NSError(domain: "Drovi", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])))
                return
            }

            completion(.success(sessionId))
        }.resume()
    }

    func uploadAudio(sessionId: String, fileURL: URL, chunkIndex: Int?, completion: @escaping (Result<Void, Error>) -> Void) {
        var components = URLComponents(url: DroviConfig.apiBaseURL.appendingPathComponent("ingest/live-session/\(sessionId)/audio"), resolvingAgainstBaseURL: false)
        var queryItems = [
            URLQueryItem(name: "organization_id", value: DroviConfig.organizationId),
            URLQueryItem(name: "transcribe", value: "true")
        ]
        if let chunkIndex = chunkIndex {
            queryItems.append(URLQueryItem(name: "chunk_index", value: String(chunkIndex)))
        }
        components?.queryItems = queryItems

        guard let url = components?.url else {
            completion(.failure(NSError(domain: "Drovi", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid URL"])))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(DroviConfig.apiKey)", forHTTPHeaderField: "Authorization")

        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        guard let audioData = try? Data(contentsOf: fileURL) else {
            completion(.failure(NSError(domain: "Drovi", code: -3, userInfo: [NSLocalizedDescriptionKey: "Failed to read audio file"])))
            return
        }

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }.resume()
    }

    func endSession(sessionId: String, completion: @escaping (Result<Void, Error>) -> Void) {
        var request = URLRequest(url: DroviConfig.apiBaseURL.appendingPathComponent("ingest/live-session/\(sessionId)/end"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(DroviConfig.apiKey)", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "organization_id": DroviConfig.organizationId,
            "run_intelligence": true,
            "source_type": "meeting"
        ]

        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            completion(.success(()))
        }.resume()
    }
}
