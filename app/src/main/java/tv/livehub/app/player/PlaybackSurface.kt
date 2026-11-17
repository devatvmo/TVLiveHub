package tv.livehub.app.player

import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import tv.livehub.app.model.ChannelSource
import tv.livehub.app.model.PlaybackType

/** Caller must pass a source already verified as FREE_VERIFIED. */
@Composable
fun PlaybackSurface(source: ChannelSource, modifier: Modifier = Modifier) {
    when (source.playbackType) {
        PlaybackType.MEDIA3_HLS, PlaybackType.MEDIA3_DASH -> Media3PlaybackSurface(source.playbackUrl, modifier)
        PlaybackType.OFFICIAL_WEBVIEW -> OfficialWebViewSurface(source.playbackUrl, modifier)
        PlaybackType.OFFICIAL_APP -> Unit
    }
}

@Composable
private fun Media3PlaybackSurface(url: String, modifier: Modifier) {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player) {
        onDispose { player.stop(); player.release() }
    }
    AndroidView(modifier = modifier, factory = { ctx ->
        PlayerView(ctx).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            useController = true
            this.player = player
        }
    }, update = { it.player = player })
}

@Composable
private fun OfficialWebViewSurface(url: String, modifier: Modifier) {
    val context = LocalContext.current
    val webView = remember {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            loadUrl(url)
        }
    }
    DisposableEffect(webView) {
        onDispose {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.removeAllViews()
            webView.destroy()
        }
    }
    AndroidView(modifier = modifier, factory = {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView
    })
}
