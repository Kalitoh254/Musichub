document.addEventListener("DOMContentLoaded", () => {
    const splash = document.getElementById("splashScreen");
    const main = document.getElementById("mainContent");
    const closeSplash = document.getElementById("closeSplash");
    const homeIcon = document.getElementById("homeIcon");
    const list = document.getElementById("songList");
    const audio = document.getElementById("audioPlayer");
    const search = document.getElementById("search");
    const count = document.getElementById("songCount");

    let songs = [];
    let currentSongIndex = -1;
    let playRequest = 0;
    const statsByName = new Map();

    function loadStats(name) {
        if (statsByName.has(name)) return statsByName.get(name);

        const defaults = { plays: 0, likes: 0, reaction: "" };
        try {
            const saved = JSON.parse(localStorage.getItem("musichub:" + name) || "null");
            if (saved && typeof saved === "object") {
                defaults.plays = Number.isSafeInteger(saved.plays) && saved.plays >= 0 ? saved.plays : 0;
                defaults.likes = Number.isSafeInteger(saved.likes) && saved.likes >= 0 ? saved.likes : 0;
                defaults.reaction = ["🔥", "😍", "😂"].includes(saved.reaction) ? saved.reaction : "";
            }
        } catch (error) {
            console.warn("Ignoring invalid saved stats for", name, error);
        }
        statsByName.set(name, defaults);
        return defaults;
    }

    function saveStats(name, stats) {
        try {
            localStorage.setItem("musichub:" + name, JSON.stringify(stats));
        } catch (error) {
            console.warn("Could not save stats for", name, error);
        }
    }

    function showMessage(message) {
        let status = document.getElementById("playerStatus");
        if (!status) {
            status = document.createElement("p");
            status.id = "playerStatus";
            status.setAttribute("role", "status");
            status.setAttribute("aria-live", "polite");
            audio.insertAdjacentElement("afterend", status);
        }
        status.textContent = message;
    }

    homeIcon.addEventListener("click", () => {
        splash.style.display = "flex";
        main.style.display = "none";
    });

    async function playSong(index) {
        if (index < 0 || index >= songs.length) return;

        const requestId = ++playRequest;
        const song = songs[index];
        currentSongIndex = index;
        audio.src = song.path;
        showMessage("Loading: " + song.name);

        try {
            await audio.play();
            if (requestId !== playRequest) return;

            const stats = loadStats(song.file);
            stats.plays += 1;
            saveStats(song.file, stats);
            updateSongStats(song.file);
            showMessage("Now playing: " + song.name);
        } catch (error) {
            if (requestId !== playRequest) return;
            showMessage("Could not play " + song.name + ". Check the file or tap Play again.");
            console.error("Playback failed:", song.name, error);
        }
    }

    function updateSongStats(file) {
        const stats = loadStats(file);
        const row = [...list.querySelectorAll(".song-item")].find(
            item => item.dataset.file === file
        );
        if (!row) return;
        row.querySelector(".like-button").textContent = `❤️ ${stats.likes}`;
        row.querySelector(".play-count").textContent = `Plays: ${stats.plays}`;
        row.querySelector(".reaction-output").textContent = stats.reaction;
    }

    function renderSongs(filter = "") {
        list.replaceChildren();
        const query = filter.trim().toLocaleLowerCase();
        const filtered = songs.filter(song => song.name.toLocaleLowerCase().includes(query));
        count.textContent = filtered.length;

        filtered.forEach(song => {
            const stats = loadStats(song.file);
            const li = document.createElement("li");
            li.className = "song-item";
            li.dataset.file = song.file;

            const nameSpan = document.createElement("span");
            nameSpan.className = "song-name";
            nameSpan.textContent = song.name;

            const priceSpan = document.createElement("span");
            priceSpan.className = "song-price";
            const price = Number(song.priceKes);
            priceSpan.textContent =
                song.priceKes !== null &&
                song.priceKes !== undefined &&
                song.priceKes !== "" &&
                Number.isFinite(price) &&
                price >= 0
                    ? "KES " + price.toFixed(2)
                    : "Price unavailable";

            const actions = document.createElement("span");
            actions.className = "song-actions";

            const playBtn = document.createElement("button");
            playBtn.textContent = "Play";
            playBtn.type = "button";
            playBtn.addEventListener("click", () => playSong(songs.indexOf(song)));

            const downloadBtn = document.createElement("button");
            downloadBtn.textContent = "Download";
            downloadBtn.type = "button";
            downloadBtn.addEventListener("click", () => {
                const link = document.createElement("a");
                link.href = song.path;
                link.download = song.file;
                link.click();
            });

            const likeBtn = document.createElement("button");
            likeBtn.className = "like-button";
            likeBtn.type = "button";
            likeBtn.textContent = `❤️ ${stats.likes}`;
            likeBtn.addEventListener("click", () => {
                stats.likes += 1;
                saveStats(song.file, stats);
                likeBtn.textContent = `❤️ ${stats.likes}`;
            });

            actions.append(playBtn, downloadBtn, likeBtn);

            const playCount = document.createElement("span");
            playCount.className = "play-count";
            playCount.textContent = `Plays: ${stats.plays}`;

            const reactionBox = document.createElement("div");
            reactionBox.className = "reactions";

            const reactionOutput = document.createElement("span");
            reactionOutput.className = "reaction-output";
            reactionOutput.textContent = stats.reaction;

            ["🔥", "😍", "😂"].forEach(emoji => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = emoji;
                button.setAttribute("aria-label", "React " + emoji + " to " + song.name);
                button.addEventListener("click", () => {
                    stats.reaction = emoji;
                    reactionOutput.textContent = emoji;
                    saveStats(song.file, stats);
                });
                reactionBox.appendChild(button);
            });

            li.append(nameSpan, priceSpan, actions, playCount, reactionBox, reactionOutput);
            list.appendChild(li);
        });
    }

    audio.addEventListener("ended", () => {
        if (currentSongIndex >= 0 && currentSongIndex + 1 < songs.length) {
            playSong(currentSongIndex + 1);
        } else {
            showMessage("End of the music library.");
        }
    });

    audio.addEventListener("error", () => {
        if (audio.currentSrc) showMessage("Audio file could not be loaded. Check your connection or the file.");
    });

    search.addEventListener("input", event => renderSongs(event.target.value));

    const API_URL = "/api/v1/songs?page=1&limit=100";
    const PRICE_CACHE_KEY = "musichub.catalog.prices.v1";

    function titleKey(value) {
        return String(value || "").replace(/\.mp3$/i, "").trim().toLocaleLowerCase();
    }

    function readCachedPrices() {
        try {
            const prices = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || "{}");
            return prices && typeof prices === "object" ? prices : {};
        } catch {
            return {};
        }
    }

    function cachePrices(records) {
        try {
            const prices = readCachedPrices();
            for (const record of records) {
                if (record && typeof record.title === "string" &&
                    record.download_price_kes != null) {
                    prices[titleKey(record.title)] = record.download_price_kes;
                }
            }
            localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(prices));
        } catch (error) {
            console.warn("Could not cache catalog prices:", error);
        }
    }

    function loadLocalCatalog() {
        return fetch("songs.json").then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        }).then(files => {
            if (!Array.isArray(files)) throw new Error("Local catalog must be an array");
            return files;
        });
    }

    function localSong(file) {
        return {
            file,
            name: file.replace(/\.mp3$/i, ""),
            path: "mshub/" + encodeURIComponent(file).replace(/%2F/gi, "/")
        };
    }

    fetch(API_URL)
        .then(response => {
            if (!response.ok) throw new Error("Catalog API HTTP " + response.status);
            return response.json();
        })
        .then(payload => {
            if (!payload || !Array.isArray(payload.data)) {
                throw new Error("Invalid catalog API response");
            }

            cachePrices(payload.data);

            return loadLocalCatalog().then(files => {
                const localByTitle = new Map(
                    files.map(file => [
                        file.replace(/\.mp3$/i, "").trim().toLocaleLowerCase(),
                        file
                    ])
                );

                const remoteSongs = payload.data.map(record => {
                    if (!record || typeof record.title !== "string") return null;

                    const file = localByTitle.get(record.title.trim().toLocaleLowerCase());
                    if (!file) return null;

                    return {
                        ...localSong(file),
                        name: record.title,
                        artist: record.artist || "",
                        priceKes: record.download_price_kes
                    };
                }).filter(Boolean);

                if (!remoteSongs.length) {
                    throw new Error("No API tracks match local audio files");
                }

                songs = remoteSongs;
                console.info("MusicHub catalog loaded from Neon:", songs.length);
                renderSongs(search.value);
            });
        })
        .catch(error => {
            console.warn("Neon catalog unavailable; using local catalog:", error);

            loadLocalCatalog()
                .then(files => {
                    const cachedPrices = readCachedPrices();
                    songs = files.map(file => ({
                        ...localSong(file),
                        priceKes: cachedPrices[titleKey(file)]
                    }));
                    console.info("MusicHub local catalog loaded:", songs.length);
                    renderSongs(search.value);
                })
                .catch(localError => {
                    console.error("Could not load either catalog:", localError);
                    list.replaceChildren();
                    const item = document.createElement("li");
                    item.textContent = "Music library could not be loaded. Reload the page and try again.";
                    list.appendChild(item);
                    showMessage("Unable to load the music catalog.");
                });
        });
});
