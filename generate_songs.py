import os
import json

# Path to mshub folder
songs_dir = "/storage/emulated/0/MusicHub/mshub"
output_file = "/storage/emulated/0/MusicHub/songs.json"

songs = [f for f in os.listdir(songs_dir) if f.endswith(".mp3")]

with open(output_file, "w") as f:
    json.dump(songs, f)

print(f"Generated {output_file} with {len(songs)} songs.")
