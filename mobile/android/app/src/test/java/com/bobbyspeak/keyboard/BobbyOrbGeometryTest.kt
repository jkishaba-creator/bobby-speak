package com.bobbyspeak.keyboard

import org.junit.Assert.assertEquals
import org.junit.Test

class BobbyOrbGeometryTest {

    @Test
    fun `orb blobs use live site proportions`() {
        val blobs = BobbyOrbGeometry.blobs(progress = 0f)

        assertRect(blobs[0].bounds, 0.09f, 0.15f, 0.80f, 0.82f)
        assertRect(blobs[1].bounds, 0.35f, 0.28f, 0.95f, 0.86f)
        assertRect(blobs[2].bounds, 0.10f, 0.65f, 0.76f, 1.10f)
    }

    @Test
    fun `dark blobs overlap into one broad diagonal core`() {
        val blobs = BobbyOrbGeometry.blobs(progress = 0f)
        val first = blobs[0].bounds
        val second = blobs[1].bounds

        val overlapWidth = minOf(first.right, second.right) -
            maxOf(first.left, second.left)
        val overlapHeight = minOf(first.bottom, second.bottom) -
            maxOf(first.top, second.top)

        assertEquals(0.45f, overlapWidth, 0.0001f)
        assertEquals(0.54f, overlapHeight, 0.0001f)
    }

    @Test
    fun `idle drift follows the live site directions`() {
        val start = BobbyOrbGeometry.blobs(progress = 0f)
        val end = BobbyOrbGeometry.blobs(progress = 1f)

        assertEquals(0.07f, end[0].offsetX - start[0].offsetX, 0.0001f)
        assertEquals(-0.05f, end[0].offsetY - start[0].offsetY, 0.0001f)
        assertEquals(-0.06f, end[1].offsetX - start[1].offsetX, 0.0001f)
        assertEquals(0.05f, end[1].offsetY - start[1].offsetY, 0.0001f)
        assertEquals(1.07f, end[1].scale, 0.0001f)
    }

    @Test
    fun `third blob drifts in the reverse direction`() {
        val start = BobbyOrbGeometry.blobs(progress = 0f)[2]
        val end = BobbyOrbGeometry.blobs(progress = 1f)[2]

        assertEquals(-0.07f, end.offsetX - start.offsetX, 0.0001f)
        assertEquals(0.05f, end.offsetY - start.offsetY, 0.0001f)
    }

    @Test
    fun `lower white bloom leaves the lower right cloud visible`() {
        val brightBloom = BobbyOrbGeometry.blobs(progress = 0f)[2].bounds

        assertEquals(0.76f, brightBloom.right, 0.0001f)
        assertEquals(1.10f, brightBloom.bottom, 0.0001f)
    }

    @Test
    fun `idle level row matches the website nine bar rhythm`() {
        assertEquals(9, BobbyOrbLevelGeometry.count)
        assertEquals(4, BobbyOrbLevelGeometry.barWidthDp)
        assertEquals(5, BobbyOrbLevelGeometry.idleHeightDp)
        assertEquals(4, BobbyOrbLevelGeometry.gapDp)
        assertEquals(20, BobbyOrbLevelGeometry.rowHeightDp)
    }

    @Test
    fun `keyboard keeps the nine bars in a compact right side module`() {
        assertEquals(9, BobbyOrbCompactLevelGeometry.count)
        assertEquals(2, BobbyOrbCompactLevelGeometry.barWidthDp)
        assertEquals(3, BobbyOrbCompactLevelGeometry.idleHeightDp)
        assertEquals(1, BobbyOrbCompactLevelGeometry.gapDp)
        assertEquals(8, BobbyOrbCompactLevelGeometry.rowHeightDp)
    }

    @Test
    fun `bottom actions use compact raised button geometry`() {
        assertEquals(46, BobbyActionButtonGeometry.heightDp)
        assertEquals(10, BobbyActionButtonGeometry.gapDp)
        assertEquals(4, BobbyActionButtonGeometry.elevationDp)
    }

    @Test
    fun `activity orb stage responds to available screen dimensions`() {
        assertEquals(240, BobbyActivityLayoutGeometry.heroOrbStageSizeDp(412, 915))
        assertEquals(205, BobbyActivityLayoutGeometry.heroOrbStageSizeDp(360, 640))
        assertEquals(196, BobbyActivityLayoutGeometry.heroOrbStageSizeDp(320, 500))
    }

    @Test
    fun `non key interactive controls meet the Android touch target`() {
        assertEquals(44, BobbyTouchTargetGeometry.minimumDp)
    }

    private fun assertRect(
        rect: BobbyUnitRect,
        left: Float,
        top: Float,
        right: Float,
        bottom: Float
    ) {
        assertEquals(left, rect.left, 0.0001f)
        assertEquals(top, rect.top, 0.0001f)
        assertEquals(right, rect.right, 0.0001f)
        assertEquals(bottom, rect.bottom, 0.0001f)
    }
}
