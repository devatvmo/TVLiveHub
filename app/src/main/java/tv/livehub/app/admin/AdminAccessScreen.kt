package tv.livehub.app.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun AdminAccessScreen(info: LocalAdminServer.AccessInfo, onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color(0xFF0B1020)).padding(horizontal = 36.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("网页管理入口", style = MaterialTheme.typography.headlineMedium, color = Color.White)
                Text("手机或电脑连接同一 Wi-Fi 后访问", color = Color(0xFF9BA9C2))
            }
            Button(onClick = onBack) { Text("返回") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("访问地址", color = Color(0xFF9BA9C2))
                if (info.urls.isEmpty()) {
                    Text("暂未检测到局域网 IPv4 地址，请确认电视已连接 Wi-Fi 或网线。", color = Color.White)
                } else {
                    info.urls.forEach { url ->
                        Surface(color = Color(0xFF151E31), shape = RoundedCornerShape(10.dp)) {
                            Text(url, Modifier.padding(14.dp), color = Color(0xFFBBD0FF), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                Text("一次性配对码", color = Color(0xFF9BA9C2))
                Text(info.pairingCode, color = Color.White, style = MaterialTheme.typography.displayMedium)
                Text("配对后网页会获得本次运行的管理令牌。请勿将配对码或二维码分享给不信任的人。", color = Color(0xFFFFD28A))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                info.urls.firstOrNull()?.let { PairingQrCode(it + "?pair=" + info.pairingCode) }
                Text("手机扫码打开", color = Color(0xFF9BA9C2))
            }
        }
        Spacer(Modifier.weight(1f))
        Text("管理服务仅在 TVLive Hub 运行期间开放；只管理频道配置，不代理或转发视频流。", color = Color(0xFF9BA9C2))
    }
}
