# Credits

All game code is original.

## Models

The four vehicles in `public/models/` come from the Quaternius "Zombie Apocalypse Kit", released
under **CC0**. The licence is kept at [docs/QUATERNIUS-License.txt](docs/QUATERNIUS-License.txt).

CC0 carries no attribution obligation. It is recorded anyway, because a public repo should be able
to answer "where did this come from" without anyone having to ask. One oddity worth writing down:
the licence file bundled with the download is headed *Ultimate Platformer Pack*, which is a
copy-paste slip in Quaternius's own packaging. The terms are the same CC0 text and the kit is listed
as CC0 on their site.

The models are not shipped as authored. The game rewrites the shared texture atlas per car at load
time so bodywork, armour and trim can be coloured independently — see `src/view/carPaint.ts`.

## Audio

Every sound effect and engine loop in `public/audio/` was generated with ElevenLabs Sound Effects
and conditioned for the game — trimmed to content, peak-normalised, and in the case of the engine
loops cut to a seamless loop point and crossfaded at the join.

**No third-party audio ships in this project, and there are no attribution obligations.**

An earlier pass used CC0 and CC-BY material from OpenGameArt and Kenney. None of it remains; the
one attribution-bearing asset (a CC-BY rocket launch) was replaced along with the rest.
