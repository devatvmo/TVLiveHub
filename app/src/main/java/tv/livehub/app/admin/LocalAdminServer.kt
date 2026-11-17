package tv.livehub.app.admin

import android.content.Context
import android.net.Uri
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import tv.livehub.app.data.ChannelConfigStore
import java.io.IOException
import java.net.NetworkInterface
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import java.util.UUID

/** LAN configuration API only. It never proxies or relays video streams. */
class LocalAdminServer(context: Context) : NanoHTTPD("0.0.0.0", PORT) {
    private val appContext = context.applicationContext
    private val store = ChannelConfigStore(appContext)
    private val random = SecureRandom()
    private val pairingCode = (100000 + random.nextInt(900000)).toString()
    private val apiToken = UUID.randomUUID().toString() + UUID.randomUUID().toString()

    data class AccessInfo(val urls: List<String>, val pairingCode: String, val port: Int)

    fun accessInfo() = AccessInfo(localIpv4Addresses().map { "http://" + it + ":" + PORT + "/" }, pairingCode, PORT)

    @Throws(IOException::class)
    fun startServer() { if (!isAlive) start(SOCKET_READ_TIMEOUT, false) }

    override fun serve(session: IHTTPSession): Response {
        return try {
            val path = session.uri.trimEnd('/').ifBlank { "/" }
            if (path == "/" || path == "/index.html") {
                val html = appContext.assets.open("admin/index.html").bufferedReader().use { it.readText() }
                return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html)
            }
            if (path == "/api/pair" && session.method == Method.POST) {
                val supplied = JSONObject(readBody(session)).optString("code")
                if (!MessageDigest.isEqual(supplied.toByteArray(), pairingCode.toByteArray())) {
                    return json(Response.Status.UNAUTHORIZED, """{"error":"配对码不正确"}""")
                }
                return json(Response.Status.OK, JSONObject().put("token", apiToken).toString())
            }
            if (!authorized(session)) return json(Response.Status.UNAUTHORIZED, """{"error":"需要先配对"}""")

            val p = path.split('/').filter { it.isNotBlank() }
            when {
                path == "/api/channels" && session.method == Method.GET ->
                    json(Response.Status.OK, JSONObject().put("channels", store.allChannels()).toString())
                path == "/api/channels" && session.method == Method.POST -> {
                    val body = JSONObject(readBody(session)); val name = body.optString("name").trim()
                    if (name.isBlank()) return badRequest("频道名称不能为空")
                    json(Response.Status.CREATED, store.createChannel(name, body.optString("category")).toString())
                }
                p.size == 3 && p[0] == "api" && p[1] == "channels" && session.method == Method.PUT -> {
                    val b = JSONObject(readBody(session)); val name = b.optString("name").trim()
                    if (name.isBlank()) return badRequest("频道名称不能为空")
                    val item = store.updateChannel(p[2], name, b.optString("category")) ?: return notFound()
                    json(Response.Status.OK, item.toString())
                }
                p.size == 3 && p[0] == "api" && p[1] == "channels" && session.method == Method.DELETE ->
                    if (store.deleteChannel(p[2])) json(Response.Status.OK, """{"ok":true}""") else notFound()
                p.size == 4 && p[0] == "api" && p[1] == "channels" && p[3] == "sources" && session.method == Method.POST -> {
                    val b = JSONObject(readBody(session)); val error = validateSource(b)
                    if (error != null) return badRequest(error)
                    val item = store.createSource(p[2], b.optString("name"), b.optString("type"), b.optString("url"), b.optInt("priority", 100)) ?: return notFound()
                    json(Response.Status.CREATED, item.toString())
                }
                p.size == 5 && p[0] == "api" && p[1] == "channels" && p[3] == "sources" && session.method == Method.PUT -> {
                    val b = JSONObject(readBody(session)); val error = validateSource(b)
                    if (error != null) return badRequest(error)
                    val item = store.updateSource(p[2], p[4], b.optString("name"), b.optString("type"), b.optString("url"), b.optInt("priority", 100), b.optBoolean("enabled", true)) ?: return notFound()
                    json(Response.Status.OK, item.toString())
                }
                p.size == 5 && p[0] == "api" && p[1] == "channels" && p[3] == "sources" && session.method == Method.DELETE ->
                    if (store.deleteSource(p[2], p[4])) json(Response.Status.OK, """{"ok":true}""") else notFound()
                else -> notFound()
            }
        } catch (e: Exception) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("error", e.message ?: "请求无法处理").toString())
        }
    }

    private fun validateSource(body: JSONObject): String? {
        if (body.optString("name").isBlank()) return "来源名称不能为空"
        if (body.optString("type") !in setOf("HLS", "DASH", "WEB")) return "不支持的来源类型"
        val uri = Uri.parse(body.optString("url").trim())
        if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank() || !uri.userInfo.isNullOrBlank())
            return "地址必须是有效的 HTTP 或 HTTPS URL，且不能包含账号密码"
        return null
    }

    private fun readBody(session: IHTTPSession): String {
        val files = HashMap<String, String>()
        session.parseBody(files)
        return files["postData"] ?: ""
    }

    private fun authorized(session: IHTTPSession): Boolean {
        val header = session.headers["authorization"] ?: return false
        return MessageDigest.isEqual(header.removePrefix("Bearer ").toByteArray(), apiToken.toByteArray())
    }

    private fun json(status: Response.IStatus, body: String) =
        newFixedLengthResponse(status, "application/json; charset=utf-8", body)
    private fun badRequest(message: String) = json(Response.Status.BAD_REQUEST, JSONObject().put("error", message).toString())
    private fun notFound() = json(Response.Status.NOT_FOUND, """{"error":"未找到对应项目"}""")

    private fun localIpv4Addresses(): List<String> = try {
        Collections.list(NetworkInterface.getNetworkInterfaces())
            .filter { it.isUp && !it.isLoopback }
            .flatMap { Collections.list(it.inetAddresses) }
            .filter { it is java.net.Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress }
            .mapNotNull { it.hostAddress }.distinct()
    } catch (_: Exception) { emptyList() }

    companion object { const val PORT = 8765 }
}
