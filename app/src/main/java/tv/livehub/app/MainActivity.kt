package tv.livehub.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
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
import tv.livehub.app.data.ChannelRepository
import tv.livehub.app.model.Channel

private val AppBg = Color(0xFF0B1020)
private val Panel = Color(0xFF151E31)
private val Accent = Color(0xFF5B8CFF)
private val Muted = Color(0xFF9BA9C2)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val channels = ChannelRepository().getVisibleChannels()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Accent, background = AppBg, surface = Panel,
                onBackground = Color.White, onSurface = Color.White
            )) { TVLiveHome(channels) }
        }
    }
}

@Composable
private fun TVLiveHome(channels: List<Channel>) {
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
            Surface(color = Color(0xFF1D2A43), shape = RoundedCornerShape(50)) {
                Text("开发测试版 0.1.0",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 9.dp),
                    color = Color(0xFFBBD0FF), style = MaterialTheme.typography.labelLarge)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            categories.forEach { category ->
                CategoryChip(category, selectedCategory == category) { selectedCategory = category }
            }
        }
        if (visible.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("频道库正在准备中", style = MaterialTheme.typography.headlineMedium,
                        color = Color.White)
                    Text("首版不会展示未经验证的频道。确认免费且可正常播放的信号源后，频道会出现在这里。",
                        color = Muted, style = MaterialTheme.typography.bodyLarge)
                    Text("支持咪咕视频、央视频、央视网及其他合法免费来源",
                        color = Color(0xFFBBD0FF))
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 220.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(visible, key = { it.id }) { channel ->
                    ChannelCard(channel) { /* Playback navigation follows in the next increment. */ }
                }
            }
        }
        Text("方向键选择 · OK 确认 · 返回退出", color = Muted,
            style = MaterialTheme.typography.labelMedium)
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
        modifier = Modifier.onFocusChanged { focused = it.isFocused }.focusable()
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
        modifier = Modifier.height(112.dp).onFocusChanged { focused = it.isFocused }.focusable()
    ) {
        Column(Modifier.fillMaxSize().padding(18.dp),
            verticalArrangement = Arrangement.SpaceBetween) {
            Text(channel.name, color = Color.White, style = MaterialTheme.typography.titleLarge)
            Text("${channel.verifiedFreeSources.size} 个已验证免费来源",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
