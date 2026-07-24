package com.bobbyspeak.keyboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.util.AttributeSet
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import kotlin.math.min
import kotlin.math.roundToInt

data class BobbyUnitRect(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float
)

data class BobbyOrbBlobGeometry(
    val bounds: BobbyUnitRect,
    val offsetX: Float,
    val offsetY: Float,
    val scale: Float
)

internal object BobbyOrbGeometry {
    fun blobs(progress: Float): List<BobbyOrbBlobGeometry> {
        val amount = progress.coerceIn(0f, 1f)
        return listOf(
            BobbyOrbBlobGeometry(
                bounds = BobbyUnitRect(0.09f, 0.15f, 0.80f, 0.82f),
                offsetX = 0.07f * amount,
                offsetY = -0.05f * amount,
                scale = 1f
            ),
            BobbyOrbBlobGeometry(
                bounds = BobbyUnitRect(0.35f, 0.28f, 0.95f, 0.86f),
                offsetX = -0.06f * amount,
                offsetY = 0.05f * amount,
                scale = 1f + 0.07f * amount
            ),
            BobbyOrbBlobGeometry(
                bounds = BobbyUnitRect(0.10f, 0.65f, 0.76f, 1.10f),
                offsetX = -0.07f * amount,
                offsetY = 0.05f * amount,
                scale = 1f
            )
        )
    }
}

internal object BobbyOrbLevelGeometry {
    const val count = 9
    const val barWidthDp = 4
    const val idleHeightDp = 5
    const val gapDp = 4
    const val rowHeightDp = 20
}

internal object BobbyOrbCompactLevelGeometry {
    const val count = 9
    const val barWidthDp = 2
    const val idleHeightDp = 3
    const val gapDp = 1
    const val rowHeightDp = 8
}

internal object BobbyActionButtonGeometry {
    const val heightDp = 46
    const val gapDp = 10
    const val elevationDp = 4
}

internal object BobbyTouchTargetGeometry {
    const val minimumDp = 44
}

internal object BobbyActivityLayoutGeometry {
    private const val minHeroStageDp = 196
    private const val maxHeroStageDp = 240

    fun heroOrbStageSizeDp(screenWidthDp: Int, screenHeightDp: Int): Int {
        val widthBound = (screenWidthDp - 40).coerceAtLeast(0)
        val heightBound = (screenHeightDp * 0.32f).roundToInt()
        val preferred = minOf(widthBound, heightBound, maxHeroStageDp)
        val availableFloor = minOf(
            minHeroStageDp,
            (screenWidthDp - 24).coerceAtLeast(0)
        )
        return preferred.coerceAtLeast(availableFloor)
    }
}

/**
 * Native rendering of the live bobby-speak.pages.dev orb.
 *
 * The measurements and blob colors mirror web/App.svelte: a 240-unit stage,
 * 12-unit face inset, 116-unit dotted ring radius, and three blurred radial
 * blobs. A single view keeps the activity and IME on the same implementation.
 */
class BobbyOrbView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private data class BlobPaintSpec(
        val colors: IntArray,
        val stops: FloatArray,
        val centerX: Float,
        val centerY: Float
    )

    private val density = resources.displayMetrics.density
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val markerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = RECORDING
    }
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(72, 40, 42, 60)
    }
    private val facePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = FACE
    }
    private val blobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
    }
    private val hairlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.argb(13, 20, 20, 30)
    }
    private val faceBounds = RectF()
    private val faceClipPath = Path()

    private val blobSpecs = listOf(
        BlobPaintSpec(
            // Android's BlurMaskFilter only softens the edge of a filled shape,
            // while CSS filter: blur() softens the gradient itself. These slightly
            // lighter stops reproduce the composited web result on a Canvas.
            colors = intArrayOf(0xFFA5A7B6.toInt(), 0xFFC7C9D4.toInt(), Color.TRANSPARENT),
            stops = floatArrayOf(0f, 0.68f, 0.94f),
            centerX = 0.48f,
            centerY = 0.44f
        ),
        BlobPaintSpec(
            colors = intArrayOf(0x78A0A2B2, 0x38B8BAC6, Color.TRANSPARENT),
            stops = floatArrayOf(0f, 0.55f, 0.92f),
            centerX = 0.42f,
            centerY = 0.48f
        ),
        BlobPaintSpec(
            colors = intArrayOf(0xEEFEFEFF.toInt(), 0x77FBFBFD, Color.TRANSPARENT),
            stops = floatArrayOf(0f, 0.50f, 0.93f),
            centerX = 0.45f,
            centerY = 0.62f
        )
    )

    private var phase: ImeVoicePhase = ImeVoicePhase.IDLE
    private var driftProgress = 0f
    private var driftAnimator: ValueAnimator? = null

    init {
        isClickable = true
        isFocusable = true
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    fun setPhase(value: ImeVoicePhase) {
        if (phase == value) return
        phase = value
        restartAnimation()
        invalidate()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        restartAnimation()
    }

    override fun onDetachedFromWindow() {
        driftAnimator?.cancel()
        driftAnimator = null
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val size = min(w, h).toFloat()
        shadowPaint.maskFilter = if (size > 0f) {
            BlurMaskFilter(26f * (size / WEB_STAGE), BlurMaskFilter.Blur.NORMAL)
        } else {
            null
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val size = min(width, height).toFloat()
        if (size <= 0f) return

        val left = (width - size) / 2f
        val top = (height - size) / 2f
        val centerX = left + size / 2f
        val centerY = top + size / 2f
        val unit = size / WEB_STAGE

        drawRing(canvas, centerX, centerY, unit)

        val faceInset = FACE_INSET * unit
        faceBounds.set(
            left + faceInset,
            top + faceInset,
            left + size - faceInset,
            top + size - faceInset
        )
        val faceRadius = faceBounds.width() / 2f

        canvas.drawCircle(
            faceBounds.centerX(),
            faceBounds.centerY() + 14f * unit,
            faceRadius - 4f * unit,
            shadowPaint
        )

        canvas.save()
        faceClipPath.reset()
        faceClipPath.addOval(faceBounds, Path.Direction.CW)
        canvas.clipPath(faceClipPath)
        canvas.drawOval(faceBounds, facePaint)
        drawBlobs(canvas, faceBounds, 18f * unit)
        canvas.restore()

        hairlinePaint.strokeWidth = maxOf(0.75f * density, unit)
        canvas.drawOval(faceBounds, hairlinePaint)
    }

    override fun performClick(): Boolean {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        return super.performClick()
    }

    private fun drawRing(
        canvas: Canvas,
        centerX: Float,
        centerY: Float,
        unit: Float
    ) {
        val recording = phase == ImeVoicePhase.LISTENING
        ringPaint.color = if (recording) RECORDING else RING_IDLE
        ringPaint.alpha = if (recording) 255 else 191
        ringPaint.strokeWidth = maxOf(1f * density, 3f * unit)
        ringPaint.pathEffect = DashPathEffect(
            floatArrayOf(maxOf(0.1f * unit, 0.1f), 15.6f * unit),
            0f
        )
        canvas.drawCircle(centerX, centerY, RING_RADIUS * unit, ringPaint)

        if (recording) {
            canvas.drawCircle(
                centerX,
                centerY - RING_RADIUS * unit,
                5f * unit,
                markerPaint
            )
        }
    }

    private fun drawBlobs(canvas: Canvas, face: RectF, blurRadius: Float) {
        val geometries = BobbyOrbGeometry.blobs(driftProgress)
        geometries.forEachIndexed { index, geometry ->
            val spec = blobSpecs[index]
            val base = geometry.bounds.toRect(face)
            val offsetX = geometry.offsetX * base.width()
            val offsetY = geometry.offsetY * base.height()
            val halfWidth = base.width() * geometry.scale / 2f
            val halfHeight = base.height() * geometry.scale / 2f
            val centerX = base.centerX() + offsetX
            val centerY = base.centerY() + offsetY
            val bounds = RectF(
                centerX - halfWidth,
                centerY - halfHeight,
                centerX + halfWidth,
                centerY + halfHeight
            )
            val gradientRadius = maxOf(bounds.width(), bounds.height()) * 0.58f
            blobPaint.shader = RadialGradient(
                bounds.left + bounds.width() * spec.centerX,
                bounds.top + bounds.height() * spec.centerY,
                gradientRadius,
                spec.colors,
                spec.stops,
                Shader.TileMode.CLAMP
            )
            blobPaint.maskFilter = BlurMaskFilter(blurRadius, BlurMaskFilter.Blur.NORMAL)
            canvas.drawOval(bounds, blobPaint)
        }
        blobPaint.shader = null
        blobPaint.maskFilter = null
    }

    private fun restartAnimation() {
        driftAnimator?.cancel()
        driftAnimator = null
        if (!isAttachedToWindow || !animatorsEnabled()) {
            driftProgress = 0f
            return
        }

        driftAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = when (phase) {
                ImeVoicePhase.LISTENING -> 3_000L
                ImeVoicePhase.PROCESSING -> 1_400L
                else -> 12_000L
            }
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener {
                driftProgress = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    private fun animatorsEnabled(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()

    private fun BobbyUnitRect.toRect(parent: RectF): RectF = RectF(
        parent.left + left * parent.width(),
        parent.top + top * parent.height(),
        parent.left + right * parent.width(),
        parent.top + bottom * parent.height()
    )

    companion object {
        private const val WEB_STAGE = 240f
        private const val FACE_INSET = 12f
        private const val RING_RADIUS = 116f
        private const val FACE = 0xFFEBEBF1.toInt()
        private const val RING_IDLE = 0xFFA6A9B5.toInt()
        private const val RECORDING = 0xFFE8620A.toInt()
    }
}
