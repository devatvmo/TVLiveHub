package tv.livehub.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import tv.livehub.app.admin.AdminAccessScreen
import tv.livehub.app.admin.LocalAdminServer
import tv.livehub.app.data.ChannelRepository
import tv.livehub.app.model.Channel
import tv.livehub.app.player.OfficialWebViewPlayer

private val AppBg = Color(0xFF0B1020)
private val Panel = Color(0xFF151E31)
private val Accent = Color(0xFF5B8CFF)
private val Muted = Color(0xFF9BA9C2)
private const val CCTV1_LIVE_PAGE = "https://tv.cctv.com/live/cctv1/"

class MainActivity : ComponentActivity() {
    private var adminServer: LocalAdminServer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val server = LocalAdminServer(this)
        runCatching { server.startServer(); adminServer = server }
        val channels = ChannelRepository().getVisibleChannels()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Accent, background = AppBg, surface = Panel,
                onBackground = Color.White, onSurface = Color.White
            )) {
                TVLiveApp(channels, adminServer?.accessInfo())
            }
        }
    }

    override fun onDestroy() {
        adminServer?.stop()
        adminServer = null
        super.onDestroy()
    }
}

@Composable
private fun TVLiveApp(channels: List<Channel>, adminInfo: LocalAdminServer.AccessInfo?) {
    var showCctvPlayer by remember { mutableStateOf(false) }
    var showAdmin by remember { mutableStateOf(false) }
    BackHandler(enabled = showCctvPlayer || showAdmin) {
        showCctvPlayer = false
        showAdmin = false
    }
    when {
        showCctvPlayer -> CctvTestPlayer(onBack = { showCctvPlayer = false })
        showAdmin -> AdminAccessScreen(
            info = adminInfo ?: LocalAdminServer.AccessInfo(emptyList(), "服务启动失败", LocalAdminServer.PORT),
            onBack = { showAdmin = false }
        )
        else -> TVLiveHome(
            channels = channels,
            onOpenCctv = { showCctvPlayer = true },
            onOpenAdmin = { showAdmin = true }
        )
    }
}

@Composable
private fun TVLiveHome(channels: List<Channel>, onOpenCctv: () -> Unit, onOpenAdmin: () -> Unit) {
    var selectedCategory by remember { mutableStateOf("全部") }
    val categories = listOf("全部", "央视", "卫视", "内蒙古")
    val visible = channels.filter { selectedCategory == "全部" || it.category == selectedCategory }

    Column(
        modifier = Modifier.fillMaxSize().background(AppBg).padding(horizontal = 42.dp, vertical = 30.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("TVLive Hub", style = MaterialTheme.typography.headlineLarge, color = Color.White)
                Text("免费电视直播 · 多平台信号源", color = Muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Button(onClick = onOpenAdmin) { Text("网页管理") }
                Surface(color = Color(0xFF1D2A43), shape = RoundedCornerShape(50)) {
                    Text("开发测试版 0.2.0",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 9.dp),
                        color = Color(0xFFBBD0FF), style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            categories.forEach { category ->
                CategoryChip(category, selectedCategory == category) { selectedCategory = category }
            }
        }
        if (visible.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("频道列表尚未配置", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                Text("可以先用手机或电脑打开网页管理，为每个频道添加自己的直播源。",
                    color = Muted, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TestChannelCard(
                        title = "网页管理入口",
                        subtitle = "手机/电脑添加频道与直播源",
                        onClick = onOpenAdmin
                    )
                    TestChannelCard(
                        title = "CCTV-1 综合",
                        subtitle = "央视网官方直播页 · 免费状态待实机验证",
                        onClick = onOpenCctv
                    )
                }
                Spacer(Modifier.height(16.dp))
                Text("新添加来源默认待验证，不会自动认定为免费或可播放。",
                    color = Color(0xFFBBD0FF))
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 220.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(visible, key = { it.id }) { channel ->
                    ChannelCard(channel) { /* Channel playback navigation follows in a later increment. */ }
                }
            }
        }
        Text("方向键选择 · OK 确认 · 返回返回频道页", color = Muted,
            style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun CctvTestPlayer(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(
            Modifier.fillMaxWidth().background(Color(0xFF111827)).padding(horizontal = 24.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text("CCTV-1 综合 · 官方网页播放测试", color = Color.White,
                    style = MaterialTheme.typography.titleLarge)
                Text("免费状态与设备兼容性尚待实测", color = Color(0xFFFFD28A),
                    style = MaterialTheme.typography.labelMedium)
            }
            Button(onClick = onBack) { Text("返回频道页") }
        }
        OfficialWebViewPlayer(
            url = CCTV1_LIVE_PAGE,
            modifier = Modifier.fillMaxSize().weight(1f)
        )
    }
}

@Composable
private fun TestChannelCard(title: String, subtitle: String, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        color = if (focused) Color(0xFF263D65) else Panel,
        shape = RoundedCornerShape(18.dp),
        border = if (focused) BorderStroke(3.dp, Accent) else BorderStroke(1.dp, Color(0xFF34435C)),
        modifier = Modifier.widthIn(min = 340.dp, max = 520.dp)
            .height(116.dp).onFocusChanged { focused = it.isFocused }
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, color = Color.White, style = MaterialTheme.typography.titleLarge)
                Text(subtitle, color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            Text("打开  ›", color = Color(0xFFBBD0FF))
        }
    }
}

@Composable
private fun CategoryChip(label: String, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        color = when { focused -> Color(0xFF29477F); selected -> Color(0xFF20365D); else -> Panel },
        shape = RoundedCornerShape(12.dp),
        border = if (focused) BorderStroke(2.dp, Color(0xFF9DBAFF)) else null,
        modifier = Modifier.onFocusChanged { focused = it.isFocused }
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 22.dp, vertical = 12.dp),
            color = Color.White, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun ChannelCard(channel: Channel, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        color = if (focused) Color(0xFF263D65) else Panel,
        shape = RoundedCornerShape(16.dp),
        border = if (focused) BorderStroke(2.dp, Accent) else null,
        modifier = Modifier.height(112.dp).onFocusChanged { focused = it.isFocused }
    ) {
        Column(Modifier.fillMaxSize().padding(18.dp),
            verticalArrangement = Arrangement.SpaceBetween) {
            Text(channel.name, color = Color.White, style = MaterialTheme.typography.titleLarge)
            Text("${channel.verifiedFreeSources.size} 个已验证免费来源",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
