package tv.livehub.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.Toast
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
import androidx.compose.ui.platform.LocalContext
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

private class LiveRemoteController {
    var onKey: ((Int) -> Boolean)? = null
    fun dispatch(keyCode: Int): Boolean = onKey?.invoke(keyCode) == true
}

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
    TvChannel("cctv1", "CCTV-1 综合", "中央电视台", "https://tv.cctv.com/live/cctv1/"),
    TvChannel("cctv2", "CCTV-2 财经", "中央电视台", "https://tv.cctv.com/live/cctv2/"),
    TvChannel("cctv3", "CCTV-3 综艺", "中央电视台", "https://tv.cctv.com/live/cctv3/"),
    TvChannel("cctv13", "CCTV-13 新闻", "中央电视台", "https://tv.cctv.com/live/cctv13/")
)

class MainActivity : ComponentActivity() {
    private val remoteController = LiveRemoteController()

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Intercept D-pad/back before WebView or its fullscreen custom view can consume them.
        if (event.action == KeyEvent.ACTION_DOWN) {
            // Ignore BACK key repeats: a long press must not count as two presses to exit.
            if (event.keyCode == KeyEvent.KEYCODE_BACK && event.repeatCount > 0) return true
            if (remoteController.dispatch(event.keyCode)) return true
        }
        return super.dispatchKeyEvent(event)
    }

    // Fallback for TV remotes whose key events reach Activity.onKeyDown after decor dispatch.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.repeatCount > 0) return true
        if (remoteController.dispatch(keyCode)) return true
        return super.onKeyDown(keyCode, event)
    }
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
                TvLiveScreen(initialChannels, remoteController)
            }
        }
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}

@Composable
private fun TvLiveScreen(channels: List<TvChannel>, remoteController: LiveRemoteController) {
    var selectedIndex by remember { mutableIntStateOf(0) }
    var page by remember { mutableStateOf("home") }
    var drawerOpen by remember { mutableStateOf(false) }
    var infoVisible by remember { mutableStateOf(true) }
    var reloadToken by remember { mutableIntStateOf(0) }
    var firstFrame by remember(selectedIndex, reloadToken) { mutableStateOf(false) }
    var playbackError by remember(selectedIndex, reloadToken) { mutableStateOf<String?>(null) }
    var noContentHint by remember(selectedIndex, reloadToken) { mutableStateOf(false) }

    val selectedChannel = channels[selectedIndex.coerceIn(channels.indices)]
    val rootFocusRequester = remember { FocusRequester() }
    val homeFocusRequester = remember { FocusRequester() }
    val drawerFocusRequester = remember { FocusRequester() }
    var drawerFocusedIndex by remember { mutableIntStateOf(0) }

    val context = LocalContext.current
    val activity = context as? ComponentActivity
    var lastBackPressedAt by remember { mutableLongStateOf(0L) }

    // One back-state machine is shared by Activity key dispatch and Compose system back.
    // Drawer -> Home -> double-back exit, matching the reference TV app's behavior.
    val handleBack = {
        when {
            drawerOpen -> {
                drawerOpen = false
                lastBackPressedAt = 0L
            }
            page == "live" -> {
                page = "home"
                lastBackPressedAt = 0L
            }
            else -> {
                val now = SystemClock.elapsedRealtime()
                if (lastBackPressedAt != 0L && now - lastBackPressedAt <= 2000L) {
                    lastBackPressedAt = 0L
                    activity?.finishAndRemoveTask()
                } else {
                    lastBackPressedAt = now
                    Toast.makeText(context, "再按一次返回键退出 TVLive", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
    BackHandler(onBack = handleBack)

    // Keep the Activity-level key dispatcher registered continuously.
    // SideEffect refreshes the lambda after state changes without a null-listener gap.
    SideEffect {
        remoteController.onKey = { code ->
            when (code) {
                KeyEvent.KEYCODE_DPAD_LEFT -> if (page == "live") {
                    drawerFocusedIndex = selectedIndex
                    drawerOpen = true
                    true
                } else false
                KeyEvent.KEYCODE_DPAD_UP -> if (page == "live") {
                    if (drawerOpen) drawerFocusedIndex = (drawerFocusedIndex - 1 + channels.size) % channels.size
                    else {
                        selectedIndex = (selectedIndex - 1 + channels.size) % channels.size
                        reloadToken++; firstFrame = false; playbackError = null; noContentHint = false; infoVisible = true
                    }
                    true
                } else false
                KeyEvent.KEYCODE_DPAD_DOWN -> if (page == "live") {
                    if (drawerOpen) drawerFocusedIndex = (drawerFocusedIndex + 1) % channels.size
                    else {
                        selectedIndex = (selectedIndex + 1) % channels.size
                        reloadToken++; firstFrame = false; playbackError = null; noContentHint = false; infoVisible = true
                    }
                    true
                } else false
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> if (page == "live" && drawerOpen) {
                    selectedIndex = drawerFocusedIndex
                    drawerOpen = false
                    reloadToken++; firstFrame = false; playbackError = null; noContentHint = false; infoVisible = true
                    true
                } else false
                KeyEvent.KEYCODE_BACK -> {
                    handleBack()
                    true
                }
                else -> false
            }
        }
    }
    DisposableEffect(remoteController) {
        onDispose { remoteController.onKey = null }
    }

    LaunchedEffect(selectedChannel.id, page) {
        if (page == "live") {
            infoVisible = true
            delay(3500)
            infoVisible = false
        }
    }

    if (page == "home") {
        HomeScreen(
            channels = channels,
            selectedIndex = selectedIndex,
            focusRequester = homeFocusRequester,
            onOpenLive = {
                selectedIndex = it
                page = "live"
                reloadToken++
                firstFrame = false
                playbackError = null
            }
        )
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {        key("${selectedChannel.id}-$reloadToken") {
            LivePlaybackSurface(
                url = selectedChannel.officialPage,
                playbackType = PlaybackType.OFFICIAL_WEBVIEW,
                modifier = Modifier.fillMaxSize(),
                onFirstFrame = { firstFrame = true; playbackError = null; noContentHint = false },
                onError = { message -> playbackError = message }
            )
        }

        LaunchedEffect(selectedChannel.id, reloadToken) {
            delay(10000)
            if (!firstFrame && playbackError == null) noContentHint = true
        }

        if (!firstFrame) {
            WaitingOverlay(
                channelName = selectedChannel.name,
                error = playbackError,
                noContentHint = noContentHint,
                onRetry = { reloadToken++; playbackError = null; noContentHint = false }
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
                modifier = Modifier.fillMaxSize().background(Color(0x99000000)).zIndex(5f)
            ) {
                ChannelDrawer(
                    channels = channels,
                    selectedIndex = selectedIndex,
                    focusRequester = drawerFocusRequester,
                    focusedIndex = drawerFocusedIndex,
                    onMoveFocus = { drawerFocusedIndex = it },
                    onClose = { drawerOpen = false },
                    onSelect = {
                        selectedIndex = it
                        drawerOpen = false
                        infoVisible = true
                        reloadToken++
                        firstFrame = false
                        playbackError = null
                    },
                    modifier = Modifier.width(430.dp).fillMaxHeight().background(Panel)
                )
                Spacer(Modifier.weight(1f))
            }
        }

        Text(
            text = "↑↓ 换台    ← 频道列表    OK 信息    返回 返回首页",
            color = Color(0x99FFFFFF),
            fontSize = 13.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(start = 30.dp, bottom = 22.dp)
        )
    }
}

@Composable
private fun HomeScreen(
    channels: List<TvChannel>,
    selectedIndex: Int,
    focusRequester: FocusRequester,
    onOpenLive: (Int) -> Unit
) {
    var focusedIndex by remember { mutableIntStateOf(0) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .focusRequester(focusRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> { focusedIndex = (focusedIndex - 1 + channels.size) % channels.size; true }
                    Key.DirectionRight -> { focusedIndex = (focusedIndex + 1) % channels.size; true }
                    Key.DirectionUp -> { focusedIndex = 0; true }
                    Key.DirectionDown -> { focusedIndex = minOf(1, channels.lastIndex); true }
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                        onOpenLive(focusedIndex.coerceIn(channels.indices))
                        true
                    }
                    else -> false
                }
            }
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 46.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("TVLive", color = Color.White, fontSize = 34.sp)
                Text("官方直播", color = Accent, fontSize = 18.sp)
            }
            Spacer(Modifier.height(42.dp))
            Text("电视直播", color = Color.White, fontSize = 28.sp)
            Text("选择频道开始观看", color = SecondaryText, fontSize = 15.sp, modifier = Modifier.padding(top = 6.dp))
            Spacer(Modifier.height(26.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                channels.forEachIndexed { index, channel ->
                    val focused = focusedIndex == index
                    Surface(
                        color = if (focused) Color(0xFF244875) else Panel,
                        border = if (focused) BorderStroke(2.dp, Accent) else null,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.width(300.dp).height(170.dp)
                    ) {
                        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.SpaceBetween) {
                            Text(if (index == selectedIndex) "继续观看" else "频道", color = if (focused) Color.White else SecondaryText, fontSize = 14.sp)
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(channel.name, color = Color.White, fontSize = 25.sp)
                                Text(channel.group, color = SecondaryText, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Text("← → 选择频道    确定进入直播    返回两次退出", color = Color(0x99FFFFFF), fontSize = 13.sp)
        }
    }
}

@Composable
private fun WaitingOverlay(
    channelName: String,
    error: String?,
    noContentHint: Boolean,
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
            if (error == null && !noContentHint) {
                CircularProgressIndicator(color = Accent)
                Text("正在连接官方直播页面，等待视频首帧…", color = SecondaryText)
            } else if (error == null) {
                Text("当前时段暂未检测到可播放内容", color = Color(0xFFFFD28A))
                Text("官方直播安排可能发生变化，请稍后再试", color = SecondaryText)
                Button(onClick = onRetry) { Text("重新加载") }
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
    focusRequester: FocusRequester,
    focusedIndex: Int,
    onMoveFocus: (Int) -> Unit,
    onClose: () -> Unit,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier.padding(start = 26.dp, end = 20.dp, top = 28.dp, bottom = 22.dp)
    ) {
        Text("频道列表", color = Color.White, fontSize = 27.sp)
        Text("中央电视台 · 官方网页入口", color = SecondaryText, fontSize = 14.sp)
        Spacer(Modifier.height(22.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            itemsIndexed(channels, key = { _, channel -> channel.id }) { index, channel ->
                val focused = focusedIndex == index
                Surface(
                    color = when { focused -> Color(0xFF244875); selectedIndex == index -> Color(0xFF1A2B42); else -> Color.Transparent },
                    border = if (focused) BorderStroke(2.dp, Accent) else null,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().height(76.dp)
                ) {
                    Row(Modifier.fillMaxSize().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(channel.name, color = Color.White, fontSize = 19.sp)
                            Text("官方网页 · 待实机验证", color = SecondaryText, fontSize = 12.sp)
                        }
                        if (selectedIndex == index) Text("正在播放", color = Color(0xFF9CC7FF), fontSize = 12.sp)
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Text("上下选择 · 确定播放 · 左键/返回关闭", color = SecondaryText, fontSize = 12.sp)
    }
}
