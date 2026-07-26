package com.brixa.musicplayer

import android.graphics.Color
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var titleView: TextView
    private lateinit var statusView: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var playButton: Button

    private val progressUpdater = object : Runnable {
        override fun run() {
            player?.let {
                seekBar.max = it.duration.coerceAtLeast(1)
                seekBar.progress = it.currentPosition
                statusView.text = formatTime(it.currentPosition) + " / " + formatTime(it.duration)
            }
            handler.postDelayed(this, 500)
        }
    }

    private val openAudio = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? -> uri?.let { loadTrack(it) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildInterface())
        handler.post(progressUpdater)
    }

    private fun buildInterface(): LinearLayout {
        val padding = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.rgb(17, 18, 24))
        }
        titleView = TextView(this).apply {
            text = "BRIXA MUSIC"
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        statusView = TextView(this).apply {
            text = "Wybierz utwór z telefonu"
            textSize = 16f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, padding, 0, padding)
        }
        seekBar = SeekBar(this).apply {
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) player?.seekTo(progress)
                }
                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) = Unit
            })
        }
        val chooseButton = Button(this).apply {
            text = "WYBIERZ MUZYKĘ"
            setOnClickListener { openAudio.launch(arrayOf("audio/*")) }
        }
        playButton = Button(this).apply {
            text = "ODTWÓRZ"
            isEnabled = false
            setOnClickListener { togglePlayback() }
        }
        val stopButton = Button(this).apply {
            text = "STOP"
            isEnabled = false
            tag = "stop"
            setOnClickListener {
                player?.pause()
                player?.seekTo(0)
                playButton.text = "ODTWÓRZ"
                seekBar.progress = 0
            }
        }
        listOf(titleView, statusView, seekBar, chooseButton, playButton, stopButton).forEach { view ->
            root.addView(view, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { setMargins(0, 10, 0, 10) })
        }
        return root
    }

    private fun loadTrack(uri: Uri) {
        player?.release()
        player = MediaPlayer().apply {
            setDataSource(this@MainActivity, uri)
            prepare()
            setOnCompletionListener {
                playButton.text = "ODTWÓRZ"
                seekBar.progress = 0
            }
        }
        titleView.text = getFileName(uri)
        seekBar.max = player?.duration ?: 0
        playButton.isEnabled = true
        val root = playButton.parent as LinearLayout
        (0 until root.childCount).map { root.getChildAt(it) }
            .filterIsInstance<Button>()
            .firstOrNull { it.tag == "stop" }
            ?.isEnabled = true
        statusView.text = "Gotowe do odtwarzania"
        Toast.makeText(this, "Utwór załadowany", Toast.LENGTH_SHORT).show()
    }

    private fun togglePlayback() {
        val currentPlayer = player ?: return
        if (currentPlayer.isPlaying) {
            currentPlayer.pause()
            playButton.text = "ODTWÓRZ"
        } else {
            currentPlayer.start()
            playButton.text = "PAUZA"
        }
    }

    private fun getFileName(uri: Uri): String {
        contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) return cursor.getString(index)
        }
        return "Wybrany utwór"
    }

    private fun formatTime(milliseconds: Int): String {
        val totalSeconds = milliseconds / 1000
        return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
    }

    override fun onDestroy() {
        handler.removeCallbacks(progressUpdater)
        player?.release()
        player = null
        super.onDestroy()
    }
}
