package tv.livehub.app.player

import android.net.http.SslError
import android.view.View
import android.view.ViewGroup
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import tv.livehub.app.model.ChannelSource
import tv.livehub.app.model.PlaybackType

/** Direct media playback must be gated by the caller's FREE_VERIFIED policy. */
@Composable
fun PlaybackSurface(source: ChannelSource, modifier: Modifier = Modifier) {
    when (source.playbackType) {
        PlaybackType.MEDIA3_HLS, PlaybackType.MEDIA3_DASH -> Media3PlaybackSurface(source.playbackUrl, modifier)
        PlaybackType.OFFICIAL_WEBVIEW -> OfficialWebViewPlayer(source.playbackUrl, modifier)
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

/**
 * Opens an official broadcaster page inside the app. This is a page-playback test,
 * not proof that the channel is free or available in every territory/account state.
 */
@Composable
fun OfficialWebViewPlayer(url: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val loading = remember(url) { mutableStateOf(true) }
    val pageError = remember(url) { mutableStateOf(false) }
    val fullScreen = remember(url) { mutableStateOf(false) }
    val containerRef = remember(url) { arrayOfNulls<FrameLayout>(1) }
    val customViewRef = remember(url) { arrayOfNulls<View>(1) }
    val customCallbackRef = remember(url) { arrayOfNulls<WebChromeClient.CustomViewCallback>(1) }

    fun leaveFullScreen() {
        val container = containerRef[0]
        customViewRef[0]?.let { container?.removeView(it) }
        customViewRef[0] = null
        container?.let { frame ->
            val currentWebView = frame.getChildAt(0)
            if (currentWebView == null) {
                // The WebView is reattached by AndroidView.update below.
            }
        }
        customCallbackRef[0]?.onCustomViewHidden()
        customCallbackRef[0] = null
        fullScreen.value = false
    }

    BackHandler(enabled = fullScreen.value) { leaveFullScreen() }

    val webView = remember(url) {
        WebView(context).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.safeBrowsingEnabled = true

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val uri = request.url
                    val host = uri.host?.lowercase().orEmpty()
                    val officialHost = host == "cctv.com" || host.endsWith(".cctv.com") ||
                        host == "cntv.cn" || host.endsWith(".cntv.cn")
                    return uri.scheme != "https" || !officialHost
                }

                override fun onPageStarted(view: WebView, pageUrl: String?, favicon: android.graphics.Bitmap?) {
                    loading.value = true
                    pageError.value = false
                }

                override fun onPageFinished(view: WebView, pageUrl: String?) {
                    loading.value = false
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: android.webkit.WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        loading.value = false
                        pageError.value = true
                    }
                }

                override fun onReceivedHttpError(
                    view: WebView,
                    request: WebResourceRequest,
                    errorResponse: android.webkit.WebResourceResponse
                ) {
                    if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                        loading.value = false
                        pageError.value = true
                    }
                }

                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    handler.cancel()
                    loading.value = false
                    pageError.value = true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    if (newProgress >= 100) loading.value = false
                }

                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                    val container = containerRef[0]
                    if (container == null) {
                        callback.onCustomViewHidden()
                        return
                    }
                    customViewRef[0]?.let { container.removeView(it) }
                    (view.parent as? ViewGroup)?.removeView(view)
                    customViewRef[0] = view
                    customCallbackRef[0] = callback
                    this@apply.visibility = View.GONE
                    container.addView(view, FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    ))
                    fullScreen.value = true
                }

                override fun onHideCustomView() {
                    leaveFullScreen()
                    this@apply.visibility = View.VISIBLE
                }
            }
            loadUrl(url)
        }
    }

    DisposableEffect(webView) {
        onDispose {
            customViewRef[0]?.let { containerRef[0]?.removeView(it) }
            customCallbackRef[0]?.onCustomViewHidden()
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.removeAllViews()
            webView.destroy()
        }
    }

    Box(modifier = modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                FrameLayout(ctx).apply {
                    containerRef[0] = this
                    addView(webView, FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    ))
                    webView.requestFocus()
                }
            },
            update = { container ->
                containerRef[0] = container
                if (customViewRef[0] == null && webView.parent !== container) {
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    container.addView(webView)
                    webView.visibility = View.VISIBLE
                }
            }
        )
        if (loading.value && !fullScreen.value) {
            CircularProgressIndicator()
        }
        if (pageError.value && !fullScreen.value) {
            Text(
                "央视网页面加载失败，请检查网络或稍后重试",
                color = Color.White,
                style = MaterialTheme.typography.titleMedium
            )
        }
    }
}
