- **The console no longer asks the daemon every 1.5 s, forever, while its first health check runs.**
  The asks now back off (1.5 s, then 2.25 s, 3.4 s, then 4 s apart) and stop after a minute. While
  the check runs, the Overview shows "Checking your installs…". If it is still not done after the
  minute, the line says the check is taking longer than usual and offers "Check again".
