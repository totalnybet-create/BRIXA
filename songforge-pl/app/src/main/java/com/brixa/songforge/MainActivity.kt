package com.brixa.songforge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Ink = Color(0xFF090B12)
private val Panel = Color(0xFF121622)
private val Purple = Color(0xFF8B5CF6)
private val Pink = Color(0xFFFF4D8D)
private val Cyan = Color(0xFF35D3E5)
private val Muted = Color(0xFF9CA6BA)

private data class Result(val style: String, val lyrics: String)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = darkColorScheme(primary = Purple, secondary = Pink, tertiary = Cyan, background = Ink, surface = Panel)) { App() } }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun App() {
    var idea by remember { mutableStateOf("") }
    var genre by remember { mutableStateOf("Pop radiowy") }
    var mood by remember { mutableStateOf("Emocjonalny") }
    var result by remember { mutableStateOf<Result?>(null) }
    var female by remember { mutableStateOf(true) }
    val genres = listOf("Pop radiowy", "Dance-pop", "Vocal trance")
    val moods = listOf("Emocjonalny", "Euforyczny", "Mroczny")

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF151333), Ink)))) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(20.dp, 24.dp, 20.dp, 36.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item { Header() }
            item {
                Text("Zamień pomysł\\nw utwór", fontSize = 38.sp, lineHeight = 40.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
                Text("Gotowy tekst i instrukcje do Suno w kilka chwil.", color = Muted, fontSize = 15.sp, modifier = Modifier.padding(top = 8.dp))
            }
            item {
                Card(shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = Panel.copy(alpha = .97f)), modifier = Modifier.border(1.dp, Color(0xFF333A58), RoundedCornerShape(24.dp))) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text("O CZYM JEST PIOSENKA?", color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        OutlinedTextField(
                            value = idea, onValueChange = { idea = it }, minLines = 4, modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("Opisz historię, emocje albo scenę…", color = Color(0xFF697287)) },
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            shape = RoundedCornerShape(18.dp),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Purple, unfocusedBorderColor = Color(0xFF39425A), focusedContainerColor = Color(0xFF101522), unfocusedContainerColor = Color(0xFF101522))
                        )
                        ChipRow(genres, genre) { genre = it }
                        ChipRow(moods, mood) { mood = it }
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text("Wokal kobiecy", fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                            Switch(checked = female, onCheckedChange = { female = it }, colors = SwitchDefaults.colors(checkedTrackColor = Purple))
                        }
                    }
                }
            }
            item {
                Button(
                    onClick = { result = generate(idea, genre, mood, female) },
                    modifier = Modifier.fillMaxWidth().height(60.dp),
                    shape = RoundedCornerShape(18.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple),
                    contentPadding = PaddingValues(16.dp)
                ) { Text("✦  WYGENERUJ DLA SUNO", fontWeight = FontWeight.ExtraBold, letterSpacing = .5.sp) }
            }
            result?.let { data ->
                item { StatusLine() }
                item { Output("STYLE / OPIS MUZYKI", data.style, Purple) }
                item { Output("LYRICS / TEKST + INSTRUKCJE", data.lyrics, Pink) }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceAround) {
                    Text("⌂\\nGenerator", color = Purple, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    Text("▣\\nProjekty", color = Muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    Text("⚙\\nUstawienia", color = Muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }
    }
}

@Composable private fun Header() {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(15.dp)).background(Brush.linearGradient(listOf(Purple, Pink))), contentAlignment = Alignment.Center) { Text("SF", fontSize = 19.sp, fontWeight = FontWeight.Black) }
        Text("SONGFORGE PL", fontSize = 19.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(start = 12.dp))
        Spacer(Modifier.weight(1f))
        Text("BETA", color = Purple, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.border(1.dp, Purple, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ChipRow(items: List<String>, selected: String, choose: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { item ->
            FilterChip(
                selected = item == selected, onClick = { choose(item) }, label = { Text(item, fontSize = 13.sp) },
                shape = RoundedCornerShape(50), colors = FilterChipDefaults.filterChipColors(containerColor = Color(0xFF1A2030), labelColor = Muted, selectedContainerColor = Purple.copy(alpha = .3f), selectedLabelColor = Color.White)
            )
        }
    }
}

@Composable private fun StatusLine() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).clip(CircleShape).background(Cyan))
        Text("  GOTOWE DO WKLEJENIA", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
    }
}

@Composable private fun Output(title: String, text: String, accent: Color) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Card(shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF10141E)), modifier = Modifier.border(1.dp, accent.copy(alpha = .55f), RoundedCornerShape(24.dp))) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, color = accent, fontSize = 11.sp, fontWeight = FontWeight.Black, modifier = Modifier.weight(1f))
                TextButton(onClick = { copy(context, text) }) { Text("KOPIUJ", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }
            HorizontalDivider(color = Color(0xFF2A3040))
            Text(text, color = Color(0xFFE9ECF4), fontSize = 14.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 14.dp))
        }
    }
}

private fun generate(idea: String, genre: String, mood: String, female: Boolean): Result {
    val topic = idea.trim().ifBlank { "Nie ma powrotu — nocna ucieczka i początek nowego życia" }
    val sound = when (genre) {
        "Dance-pop" -> "modern Polish dance-pop, 126 BPM, punchy four-on-the-floor kick, glossy synths, warm bass"
        "Vocal trance" -> "euphoric vocal trance, 138 BPM, cinematic pads, arpeggiated synths, supersaw climax, deep clean bass"
        else -> "modern Polish radio pop, 112 BPM, warm bass, electric piano, polished electronic drums, memorable hook"
    }
    val feeling = when (mood) {
        "Euforyczny" -> "uplifting, liberating, euphoric"
        "Mroczny" -> "dark, nocturnal, tense, mysterious"
        else -> "deeply emotional, intimate at first, cathartic in the final chorus"
    }
    val voice = if (female) "powerful distinctive female lead, clear Polish diction" else "warm low male lead, clear Polish diction"
    val style = sound + "; " + feeling + "; " + voice + "; two story verses, rising pre-choruses, explosive radio chorus, short instrumental break, near-silent bridge, biggest final chorus; natural dynamics, no spoken stage directions sung aloud."
    val lyrics = "[Intro – intimate, sparse piano, distant pads]\\n\\n" +
        topic + ".\\nJeszcze nie wiem, dokąd prowadzi ten ślad,\\nale pierwszy raz naprawdę chcę tam iść.\\n\\n" +
        "[Verse 1 – restrained storytelling]\\n\\nMiasto milczy, szyby łapią obcy blask,\\nw lusterku maleje wszystko, czego było żal.\\nNie zabieram dawnych obietnic ani słów,\\ndzisiaj uczę własne serce, jak oddychać znów.\\n\\n" +
        "[Pre-Chorus – melody rises, drums enter gradually]\\n\\nJeszcze jeden zakręt, jeszcze jeden znak,\\nkażdy kilometr oddaje mi mój świat.\\n\\n" +
        "[Chorus – explosive, memorable title hook]\\n\\n" + topic + ", nie zatrzymuj mnie,\\nto, co było cieniem, dziś rozpada się.\\n" + topic + ", teraz dobrze wiem,\\nnie ma już powrotu, kiedy budzi się dzień.\\n\\n" +
        "[Bridge – cut drums to near silence, raw exposed vocal]\\n\\nW lusterku znika ten stracony sen,\\nprzed nami świt przecina szarą mgłę.\\nNie wiem jeszcze, gdzie zakończy się ta noc,\\nlecz pierwszy raz nie boję się.\\n\\n[Final Chorus – biggest vocal, full arrangement]";
    return Result(style, lyrics)
}

private fun copy(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("SongForge PL", text))
    Toast.makeText(context, "Skopiowano do schowka", Toast.LENGTH_SHORT).show()
}
