package tv.livehub.app.player

import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import tv.livehub.app.model.PlaybackType

/**
 * A single active playback surface is mounted by the TV screen.
 * The caller keys this composable by channel ID so the previous engine is disposed
 * before the next channel is mounted.
 */
@Composable
fun LivePlaybackSurface(
    url: String,
    playbackType: PlaybackType,
    modifier: Modifier = Modifier,
    onFirstFrame: () -> Unit,
    onError: (String) -> Unit
) {
    when (playbackType) {
        PlaybackType.MEDIA3_HLS, PlaybackType.MEDIA3_DASH ->
            Media3Surface(url, modifier, onFirstFrame, onError)
        PlaybackType.OFFICIAL_WEBVIEW ->
            OfficialWebViewSurface(url, modifier, onFirstFrame, onError)
        PlaybackType.OFFICIAL_APP ->
            UnsupportedSurface(modifier, "该官方内容需要通过官方应用播放")
    }
}

@Composable
private fun Media3Surface(
    url: String,
    modifier: Modifier,
    onFirstFrame: () -> Unit,
    onError: (String) -> Unit
) {
    val context = LocalContext.current
    val firstFrameCallback by rememberUpdatedState(onFirstFrame)
    val errorCallback by rememberUpdatedState(onError)
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            setMediaItem(MediaItem.fromUri(url))
            playWhenReady = true
            prepare()
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() {
                player.volume = 1f
                firstFrameCallback()
            }

            override fun onPlayerError(error: PlaybackException) {
                player.volume = 0f
                errorCallback("直播播放失败：${error.errorCodeName}")
            }
        }
        player.addListener(listener)
        onDispose {
            player.volume = 0f
            player.removeListener(listener)
            player.stop()
            player.release()
        }
    }

    AndroidView(
        modifier = modifier.background(Color.Black),
        factory = { viewContext ->
            PlayerView(viewContext).apply {
                useController = false
                setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                this.player = player
            }
        },
        update = { it.player = player }
    )
}

private class FirstFrameBridge(
    private val callback: () -> Unit
) {
    @JavascriptInterface
    fun onFirstFrame() {
        Handler(Looper.getMainLooper()).post { callback() }
    }
}

@Composable
private fun OfficialWebViewSurface(
    url: String,
    modifier: Modifier,
    onFirstFrame: () -> Unit,
    onError: (String) -> Unit
) {
    val context = LocalContext.current
    val frameCallback by rememberUpdatedState(onFirstFrame)
    val errorCallback by rememberUpdatedState(onError)
    var loading by remember(url) { mutableStateOf(true) }
    var pageError by remember(url) { mutableStateOf(false) }
    val allowedHosts = remember {
        listOf("cctv.com", "cntv.cn", "yangshipin.cn", "nmtv.cn", "cztv.com", "btv.com.cn")
    }

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
            addJavascriptInterface(FirstFrameBridge { frameCallback() }, "TVLiveBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return false
                    val uri = request.url
                    val host = uri.host?.lowercase().orEmpty()
                    val officialHost = allowedHosts.any { host == it || host.endsWith(".$it") }
                    return uri.scheme != "https" || !officialHost
                }

                override fun onPageStarted(view: WebView, pageUrl: String?, favicon: android.graphics.Bitmap?) {
                    loading = true
                    pageError = false
                }

                override fun onPageFinished(view: WebView, pageUrl: String?) {
                    loading = false
                    view.evaluateJavascript(FIRST_FRAME_PROBE, null)
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: android.webkit.WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        loading = false
                        pageError = true
                        errorCallback("官方直播页面加载失败，请检查网络后重试")
                    }
                }

                override fun onReceivedHttpError(
                    view: WebView,
                    request: WebResourceRequest,
                    errorResponse: android.webkit.WebResourceResponse
                ) {
                    if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                        loading = false
                        pageError = true
                        errorCallback("官方页面返回 HTTP ${errorResponse.statusCode}")
                    }
                }

                override fun onReceivedSslError(
                    view: WebView,
                    handler: SslErrorHandler,
                    error: SslError
                ) {
                    handler.cancel()
                    loading = false
                    pageError = true
                    errorCallback("官方页面 HTTPS 证书校验失败")
                }
            }

            loadUrl(url)
        }
    }

    DisposableEffect(webView) {
        onDispose {
            runCatching {
                webView.evaluateJavascript(
                    "document.querySelectorAll('video').forEach(v => { v.pause(); v.muted = true; });",
                    null
                )
                webView.onPause()
                webView.stopLoading()
                webView.loadUrl("about:blank")
                webView.removeJavascriptInterface("TVLiveBridge")
                webView.removeAllViews()
                webView.destroy()
            }
        }
    }

    Box(modifier = modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { viewContext ->
                FrameLayout(viewContext).apply {
                    addView(
                        webView,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    )
                    webView.requestFocus()
                }
            },
            update = { container ->
                if (webView.parent !== container) {
                    (webView.parent as? android.view.ViewGroup)?.removeView(webView)
                    container.addView(
                        webView,
                        FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    )
                }
            }
        )
        if (loading && !pageError) {
            CircularProgressIndicator()
        }
        if (pageError) {
            Text("直播页面暂不可用", color = Color.White)
        }
    }
}

@Composable
private fun UnsupportedSurface(modifier: Modifier, message: String) {
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        Text(message, color = Color.White)
    }
}

private const val FIRST_FRAME_PROBE = """
(function () {
  if (window.__tvLiveProbeInstalled) return;
  window.__tvLiveProbeInstalled = true;
  var reported = false;
  function report(video) {
    if (reported || !video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    reported = true;
    try {
      if (window.TVLiveBridge && window.TVLiveBridge.onFirstFrame) {
        window.TVLiveBridge.onFirstFrame();
      }
    } catch (e) {}
    try {
      document.querySelectorAll('video').forEach(function (v) { v.muted = false; });
    } catch (e) {}
  }
  function scan() {
    var videos = document.querySelectorAll('video');
    videos.forEach(function (video) {
      if (!reported) video.muted = true;
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (video.requestVideoFrameCallback) {
          video.requestVideoFrameCallback(function () { report(video); });
        } else if (!video.__tvLiveFrameWatch) {
          video.__tvLiveFrameWatch = true;
          video.addEventListener('playing', function () { report(video); }, { once: true });
        }
      }
    });
  }
  document.addEventListener('play', function (event) {
    if (!reported && event.target && event.target.tagName === 'VIDEO') event.target.muted = true;
    scan();
  }, true);
  scan();
  setInterval(scan, 500);
})();
"""
