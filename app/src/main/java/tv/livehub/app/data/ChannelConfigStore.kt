package tv.livehub.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Local-only configuration. New sources remain PENDING until verified on-device. */
class ChannelConfigStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("tvlivehub_config", Context.MODE_PRIVATE)

    @Synchronized fun allChannels() = JSONArray(prefs.getString(KEY_CHANNELS, "[]") ?: "[]")

    @Synchronized fun createChannel(name: String, category: String): JSONObject {
        val item = JSONObject().put("id", UUID.randomUUID().toString())
            .put("name", name.trim()).put("category", category.trim().ifBlank { "自定义" })
            .put("sources", JSONArray())
        val all = allChannels(); all.put(item); save(all); return item
    }

    @Synchronized fun updateChannel(id: String, name: String, category: String): JSONObject? {
        val all = allChannels()
        for (i in 0 until all.length()) {
            val item = all.getJSONObject(i)
            if (item.optString("id") == id) {
                item.put("name", name.trim()).put("category", category.trim().ifBlank { "自定义" })
                save(all); return item
            }
        }
        return null
    }

    @Synchronized fun deleteChannel(id: String): Boolean {
        val old = allChannels(); val next = JSONArray(); var removed = false
        for (i in 0 until old.length()) {
            val item = old.getJSONObject(i)
            if (item.optString("id") == id) removed = true else next.put(item)
        }
        if (removed) save(next)
        return removed
    }

    @Synchronized fun createSource(channelId: String, name: String, type: String, url: String, priority: Int): JSONObject? {
        val channel = findChannel(channelId) ?: return null
        val source = JSONObject().put("id", UUID.randomUUID().toString())
            .put("name", name.trim()).put("type", type).put("url", url.trim())
            .put("priority", priority).put("enabled", true).put("freeStatus", "PENDING")
            .put("lastTestAt", JSONObject.NULL).put("lastTestResult", "尚未在电视设备验证")
        channel.getJSONArray("sources").put(source); save(allChannels()); return source
    }

    @Synchronized fun updateSource(channelId: String, sourceId: String, name: String, type: String, url: String, priority: Int, enabled: Boolean): JSONObject? {
        val channel = findChannel(channelId) ?: return null
        val sources = channel.getJSONArray("sources")
        for (i in 0 until sources.length()) {
            val source = sources.getJSONObject(i)
            if (source.optString("id") == sourceId) {
                source.put("name", name.trim()).put("type", type).put("url", url.trim())
                    .put("priority", priority).put("enabled", enabled)
                save(allChannels()); return source
            }
        }
        return null
    }

    @Synchronized fun deleteSource(channelId: String, sourceId: String): Boolean {
        val channel = findChannel(channelId) ?: return false
        val old = channel.getJSONArray("sources"); val next = JSONArray(); var removed = false
        for (i in 0 until old.length()) {
            val item = old.getJSONObject(i)
            if (item.optString("id") == sourceId) removed = true else next.put(item)
        }
        if (removed) { channel.put("sources", next); save(allChannels()) }
        return removed
    }

    private fun findChannel(id: String): JSONObject? {
        val all = allChannels()
        for (i in 0 until all.length()) {
            val item = all.getJSONObject(i)
            if (item.optString("id") == id) return item
        }
        return null
    }

    private fun save(value: JSONArray) { prefs.edit().putString(KEY_CHANNELS, value.toString()).apply() }

    companion object { private const val KEY_CHANNELS = "channels_v1" }
}
