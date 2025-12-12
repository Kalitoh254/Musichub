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

    // Show splash screen first only when clicking home icon
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
            songs = data.map(name => ({ name: name.replace(".mp3",""), path: "mshub/" + name }));
            renderSongs();
        })
        .catch(err => { console.error(err); list.innerHTML = "<li>Error loading songs.</li>"; });

    function renderSongs(filter="") {
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

            const playBtn = document.createElement("button");
            playBtn.textContent = "Play";
            playBtn.onclick = () => {
                currentIndex = index;
                audio.src = song.path;
                audio.play();
            };

            const downloadBtn = document.createElement("button");
            downloadBtn.textContent = "Download";
            downloadBtn.onclick = () => {
                const link = document.createElement('a');
                link.href = song.path;
                link.download = song.name;
                link.click();
            };

            actions.appendChild(playBtn);
            actions.appendChild(downloadBtn);
            li.appendChild(nameSpan);
            li.appendChild(actions);
            list.appendChild(li);
        });
    }

    search.addEventListener("input", (e) => renderSongs(e.target.value));

    audio.addEventListener("ended", () => {
        currentIndex++;
        if(currentIndex < songs.length){
            audio.src = songs[currentIndex].path;
            audio.play();
        }
    });
});
