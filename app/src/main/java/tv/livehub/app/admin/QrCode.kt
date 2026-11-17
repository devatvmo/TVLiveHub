package tv.livehub.app.admin

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

@Composable
fun PairingQrCode(content: String, modifier: Modifier = Modifier) {
    val bitmap = runCatching {
        val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, 320, 320)
        Bitmap.createBitmap(320, 320, Bitmap.Config.ARGB_8888).also { bmp ->
            for (x in 0 until 320) for (y in 0 until 320) {
                bmp.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
    }.getOrNull()
    Box(modifier = modifier.size(180.dp).background(Color.White)) {
        if (bitmap != null) Image(bitmap.asImageBitmap(), contentDescription = "扫码打开 TVLive Hub 管理网页")
    }
}
