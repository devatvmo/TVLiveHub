package tv.livehub.app.model

enum class PlaybackType { MEDIA3_HLS, MEDIA3_DASH, OFFICIAL_WEBVIEW, OFFICIAL_APP }
enum class FreeStatus { FREE_VERIFIED, PENDING, LOGIN_REQUIRED, VIP_REQUIRED, REGION_RESTRICTED, UNAVAILABLE }

data class ChannelSource(
    val id: String,
    val providerName: String,
    val playbackType: PlaybackType,
    val playbackUrl: String,
    val freeStatus: FreeStatus,
    val priority: Int = 100,
    val qualityLabel: String? = null,
    val enabled: Boolean = true,
    val lastVerifiedAt: Long? = null,
    val lastError: String? = null
)

data class Channel(
    val id: String,
    val name: String,
    val category: String,
    val sources: List<ChannelSource> = emptyList()
) {
    val verifiedFreeSources: List<ChannelSource>
        get() = sources.filter { it.enabled && it.freeStatus == FreeStatus.FREE_VERIFIED }.sortedBy { it.priority }
    val isVisible: Boolean get() = verifiedFreeSources.isNotEmpty()
}
