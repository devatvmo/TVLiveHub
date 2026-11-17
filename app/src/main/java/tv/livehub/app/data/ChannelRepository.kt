package tv.livehub.app.data

import tv.livehub.app.model.Channel

/** No unverified playback endpoints are shipped in the 0.1.0 baseline. */
class ChannelRepository {
    fun getVisibleChannels(): List<Channel> = emptyList()
}
