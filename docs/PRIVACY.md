# MiroraTrack privacy and connectivity

MiroraTrack does not require an Internet connection, backend, cloud database,
or cloud synchronization. Finance data is stored locally on the user's
computer in the application's IndexedDB database. Small preferences are stored
in localStorage. Backup files are written only to MiroraTrack's local backup folder or to an alternative location selected by the user.

MiroraTrack does not include advertising analytics or application analytics,
and the application does not send finance records to MiroraTrack-operated
services.

The Windows desktop application uses the Microsoft WebView2 runtime. WebView2
may process or send Microsoft-required diagnostics under Microsoft and Windows privacy controls.
Those runtime diagnostics are separate from MiroraTrack's application analytics
and finance-data handling.
