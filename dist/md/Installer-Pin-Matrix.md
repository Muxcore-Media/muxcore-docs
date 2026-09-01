# Installer pin matrix

Canonical pin tables and the atomic update rule live in the installer repo:

- Source of truth: [`muxcore-installer/versions.env`](https://github.com/Muxcore-Media/muxcore-installer/blob/main/versions.env)
- Documented matrix: [`muxcore-installer/PIN-MATRIX.md`](https://github.com/Muxcore-Media/muxcore-installer/blob/main/PIN-MATRIX.md)
- Check: `muxcore-installer/scripts/check-pin-matrix.sh` (compares installer pins to `spool/tags/*.json`)

When bumping a module tag used by both installer and spool, update both in the same change set.
