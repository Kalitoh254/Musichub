document.addEventListener("DOMContentLoaded", () => {
    const splash = document.getElementById("splashScreen");
    const main = document.getElementById("mainContent");
    const closeSplash = document.getElementById("closeSplash");
    const homeIcon = document.getElementById("homeIcon");
    const list = document.getElementById("songList");
    const audio = document.getElementById("audioPlayer");
    const search = document.getElementById("search");
    const count = document.getElementById("songCount");

    let currentIndex = 0;
    let songs = [];

    // Splash controls
    closeSplash.addEventListener("click", () => {
        splash.style.display = "none";
        main.style.display = "block";
    });

    homeIcon.addEventListener("click", () => {
        splash.style.display = "flex";
        main.style.display = "none";
    });

    // Load songs
    fetch("songs.json")
        .then(res => res.json())
        .then(data => {
            songs = data.map(name => ({
                name: name.replace(".mp3",""),
                path: "mshub/" + name
            }));
            renderSongs();
        })
        .catch(err => {
            console.error(err);
            list.innerHTML = "<li>Error loading songs.</li>";
        });

    // Render Song List
    function renderSongs(filter = "") {
        list.innerHTML = "";
        const filtered = songs.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));
        count.textContent = filtered.length;

        filtered.forEach((song, index) => {
            const li = document.createElement("li");
            li.className = "song-item";

            const nameSpan = document.createElement("span");
            nameSpan.className = "song-name";
            nameSpan.textContent = song.name;

            const actions = document.createElement("span");
            actions.className = "song-actions";

            // PLAY BUTTON
            const playBtn = document.createElement("button");
            playBtn.textContent = "Play";

            // DOWNLOAD BUTTON
            const downloadBtn = document.createElement("button");
            downloadBtn.textContent = "Download";
            downloadBtn.onclick = () => {
                const a = document.createElement("a");
                a.href = song.path;
                a.download = song.name;
                a.click();
            };

            // ─────────── SONG STATS ───────────

            let stats = JSON.parse(localStorage.getItem(song.name)) || {
                plays: 0,
                likes: 0,
                reaction: ""
            };

            // LIKE BUTTON
            const likeBtn = document.createElement("button");
            likeBtn.textContent = `❤️ ${stats.likes}`;
            likeBtn.onclick = () => {
                stats.likes++;
                likeBtn.textContent = `❤️ ${stats.likes}`;
                localStorage.setItem(song.name, JSON.stringify(stats));
            };

            // PLAY COUNT UI
            const playCount = document.createElement("span");
            playCount.className = "play-count";
            playCount.textContent = `Plays: ${stats.plays}`;

            // REACTIONS
            const reactionBox = document.createElement("div");
            reactionBox.className = "reactions";

            const reactionOutput = document.createElement("span");
            reactionOutput.className = "reaction-output";
            reactionOutput.textContent = stats.reaction;

            ["🔥", "😍", "😂"].forEach(emoji => {
                const r = document.createElement("button");
                r.textContent = emoji;
                r.onclick = () => {
                    stats.reaction = emoji;
                    reactionOutput.textContent = emoji;
                    localStorage.setItem(song.name, JSON.stringify(stats));
                };
                reactionBox.appendChild(r);
            });

            // PLAY BUTTON - WITH PLAY COUNTER UPDATE
            playBtn.onclick = () => {
                currentIndex = index;
                audio.src = song.path;
                audio.play();

                stats.plays++;
                playCount.textContent = `Plays: ${stats.plays}`;
                localStorage.setItem(song.name, JSON.stringify(stats));
            };

            // Append UI elements
            actions.appendChild(playBtn);
            actions.appendChild(downloadBtn);
            actions.appendChild(likeBtn);

            li.appendChild(nameSpan);
            li.appendChild(actions);
            li.appendChild(playCount);
            li.appendChild(reactionBox);
            li.appendChild(reactionOutput);

            list.appendChild(li);
        });
    }

    search.addEventListener("input", (e) => renderSongs(e.target.value));

    // Auto play next song
    audio.addEventListener("ended", () => {
        currentIndex++;
        if (currentIndex < songs.length) {
            audio.src = songs[currentIndex].path;
            audio.play();
        }
    });
});