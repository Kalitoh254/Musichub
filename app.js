document.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("songList");
    const audio = document.getElementById("audioPlayer");
    let currentIndex = 0;
    let songs = [];

    fetch("songs.json")
        .then(res => res.json())
        .then(data => {
            songs = data.map(name => "mshub/" + name);
            if (songs.length === 0) {
                list.innerHTML = "<li>No songs found.</li>";
                return;
            }

            songs.forEach((path, index) => {
                const li = document.createElement("li");
                li.className = "song-item";

                const nameSpan = document.createElement("span");
                nameSpan.className = "song-name";
                nameSpan.textContent = path.split("/").pop().replace(".mp3", "");

                const actions = document.createElement("span");
                actions.className = "song-actions";

                const playBtn = document.createElement("button");
                playBtn.textContent = "Play";
                playBtn.onclick = () => {
                    currentIndex = index;
                    audio.src = path;
                    audio.play();
                };

                const downloadBtn = document.createElement("button");
                downloadBtn.textContent = "Download";
                downloadBtn.onclick = () => {
                    const link = document.createElement('a');
                    link.href = path;
                    link.download = path.split("/").pop();
                    link.click();
                };

                actions.appendChild(playBtn);
                actions.appendChild(downloadBtn);
                li.appendChild(nameSpan);
                li.appendChild(actions);
                list.appendChild(li);
            });

            audio.addEventListener("ended", () => {
                currentIndex++;
                if (currentIndex < songs.length) {
                    audio.src = songs[currentIndex];
                    audio.play();
                }
            });
        })
        .catch(err => {
            console.error("Failed to load songs:", err);
            list.innerHTML = "<li>Error loading songs.</li>";
        });
});
