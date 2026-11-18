package tv.livehub.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import tv.livehub.app.model.PlaybackType
import tv.livehub.app.player.LivePlaybackSurface

private val Background = Color(0xFF070B12)
private val Panel = Color(0xFF111A28)
private val Accent = Color(0xFF65A9FF)
private val SecondaryText = Color(0xFFAAB7C9)

private data class TvChannel(
    val id: String,
    val name: String,
    val group: String,
    val officialPage: String
)

/**
 * These are official broadcaster page entry points, not verified direct media URLs.
 * Actual playback and first-frame behavior must be checked on the target TV box.
 */
private val initialChannels = listOf(
    TvChannel(
        id = "cctv1",
        name = "CCTV-1 综合",
        group = "中央电视台",
        officialPage = "https://tv.cctv.com/live/cctv1/"
    ),
    TvChannel(
        id = "cctv13",
        name = "CCTV-13 新闻",
        group = "中央电视台",
        officialPage = "https://tv.cctv.com/live/cctv13/"
    )
)

class MainActivity : ComponentActivity() {
    @Suppress("DEPRECATION")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Accent,
                    background = Background,
                    surface = Panel,
                    onBackground = Color.White,
                    onSurface = Color.White
                )
            ) {
                TvLiveScreen(initialChannels)
            }
        }
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}

@Composable
private fun TvLiveScreen(channels: List<TvChannel>) {
    var selectedIndex by remember { mutableIntStateOf(0) }
    var drawerOpen by remember { mutableStateOf(false) }
    var infoVisible by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }
    var firstFrame by remember(selectedIndex, reloadToken) { mutableStateOf(false) }
    var playbackError by remember(selectedIndex, reloadToken) { mutableStateOf<String?>(null) }

    val selectedChannel = channels[selectedIndex.coerceIn(channels.indices)]
    val focusRequesters = remember(channels) { channels.map { FocusRequester() } }

    BackHandler(enabled = drawerOpen) { drawerOpen = false }

    LaunchedEffect(selectedChannel.id) {
        infoVisible = true
        delay(3500)
        infoVisible = false
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> {
                        drawerOpen = !drawerOpen
                        true
                    }
                    Key.DirectionUp -> {
                        if (drawerOpen) false else {
                            selectedIndex = (selectedIndex - 1 + channels.size) % channels.size
                            infoVisible = true
                            true
                        }
                    }
                    Key.DirectionDown -> {
                        if (drawerOpen) false else {
                            selectedIndex = (selectedIndex + 1) % channels.size
                            infoVisible = true
                            true
                        }
                    }
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                        if (drawerOpen) false else {
                            infoVisible = !infoVisible
                            true
                        }
                    }
                    else -> false
                }
            }
    ) {
        key("${selectedChannel.id}-$reloadToken") {
            LivePlaybackSurface(
                url = selectedChannel.officialPage,
                playbackType = PlaybackType.OFFICIAL_WEBVIEW,
                modifier = Modifier.fillMaxSize(),
                onFirstFrame = {
                    firstFrame = true
                    playbackError = null
                },
                onError = { message ->
                    playbackError = message
                }
            )
        }

        if (!firstFrame) {
            WaitingOverlay(
                channelName = selectedChannel.name,
                error = playbackError,
                onRetry = {
                    reloadToken++
                    playbackError = null
                }
            )
        }

        if (infoVisible || !firstFrame) {
            ChannelInfoOverlay(
                channel = selectedChannel,
                firstFrame = firstFrame,
                modifier = Modifier.align(Alignment.TopStart)
            )
        }

        if (drawerOpen) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0x99000000))
                    .zIndex(5f)
            ) {
                ChannelDrawer(
                    channels = channels,
                    selectedIndex = selectedIndex,
                    focusRequesters = focusRequesters,
                    onFocused = { selectedIndex = it },
                    onSelect = {
                        selectedIndex = it
                        drawerOpen = false
                        infoVisible = true
                    },
                    modifier = Modifier
                        .width(430.dp)
                        .fillMaxHeight()
                        .background(Panel)
                )
                Spacer(Modifier.weight(1f))
            }
        }

        Text(
            text = "↑↓ 换台    ← 频道列表    OK 信息    返回 关闭列表",
            color = Color(0x99FFFFFF),
            fontSize = 13.sp,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 30.dp, bottom = 22.dp)
        )
    }
}

@Composable
private fun WaitingOverlay(
    channelName: String,
    error: String?,
    onRetry: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF080D16)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("TVLive", color = Color.White, fontSize = 34.sp)
            Text(channelName, color = Color(0xFFD8E6F8), fontSize = 22.sp)
            if (error == null) {
                CircularProgressIndicator(color = Accent)
                Text("正在连接官方直播页面，等待视频首帧…", color = SecondaryText)
            } else {
                Text(error, color = Color(0xFFFFC1B8))
                Button(onClick = onRetry) { Text("重新加载") }
            }
        }
    }
}

@Composable
private fun ChannelInfoOverlay(
    channel: TvChannel,
    firstFrame: Boolean,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .padding(28.dp)
            .background(Color(0xCC101827), RoundedCornerShape(14.dp))
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(channel.name, color = Color.White, fontSize = 23.sp)
        Text(
            if (firstFrame) "官方页面 · 已检测到视频首帧" else "官方页面入口 · 播放待验证",
            color = if (firstFrame) Color(0xFF9FE2B2) else Color(0xFFFFD28A),
            fontSize = 13.sp
        )
    }
}

@Composable
private fun ChannelDrawer(
    channels: List<TvChannel>,
    selectedIndex: Int,
    focusRequesters: List<FocusRequester>,
    onFocused: (Int) -> Unit,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(selectedIndex) {
        focusRequesters.getOrNull(selectedIndex)?.requestFocus()
    }

    Column(modifier.padding(start = 26.dp, end = 20.dp, top = 28.dp, bottom = 22.dp)) {
        Text("频道列表", color = Color.White, fontSize = 27.sp)
        Text("中央电视台 · 官方网页入口", color = SecondaryText, fontSize = 14.sp)
        Spacer(Modifier.height(22.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            itemsIndexed(channels, key = { _, channel -> channel.id }) { index, channel ->
                var focused by remember { mutableStateOf(false) }
                Surface(
                    onClick = { onSelect(index) },
                    color = when {
                        focused -> Color(0xFF244875)
                        selectedIndex == index -> Color(0xFF1A2B42)
                        else -> Color.Transparent
                    },
                    border = if (focused) BorderStroke(2.dp, Accent) else null,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(76.dp)
                        .focusRequester(focusRequesters[index])
                        .onFocusChanged {
                            focused = it.isFocused
                            if (it.isFocused) onFocused(index)
                        }
                ) {
                    Row(
                        Modifier.fillMaxSize().padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(channel.name, color = Color.White, fontSize = 19.sp)
                            Text("官方网页 · 待实机验证", color = SecondaryText, fontSize = 12.sp)
                        }
                        if (selectedIndex == index) {
                            Text("正在播放", color = Color(0xFF9CC7FF), fontSize = 12.sp)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Text("上下选择 · 确定播放 · 左键/返回关闭", color = SecondaryText, fontSize = 12.sp)
    }
}
