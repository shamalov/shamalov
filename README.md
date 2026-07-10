# Hi there 👋

My contribution graph, turned into a Breakout game — each brick is a day of commits.

### Pick a theme

<p align="center">
  <a href="#" onclick="document.querySelectorAll('.breakout-theme').forEach(function(e){e.style.display='none'});document.getElementById('theme-github').style.display='block';return false"><kbd>🟢 GitHub</kbd></a>&nbsp;
  <a href="#" onclick="document.querySelectorAll('.breakout-theme').forEach(function(e){e.style.display='none'});document.getElementById('theme-neon').style.display='block';return false"><kbd>💜 Neon</kbd></a>&nbsp;
  <a href="#" onclick="document.querySelectorAll('.breakout-theme').forEach(function(e){e.style.display='none'});document.getElementById('theme-ocean').style.display='block';return false"><kbd>🌊 Ocean</kbd></a>&nbsp;
  <a href="#" onclick="document.querySelectorAll('.breakout-theme').forEach(function(e){e.style.display='none'});document.getElementById('theme-sunset').style.display='block';return false"><kbd>🌅 Sunset</kbd></a>&nbsp;
  <a href="#" onclick="document.querySelectorAll('.breakout-theme').forEach(function(e){e.style.display='none'});document.getElementById('theme-retro').style.display='block';return false"><kbd>👾 Retro</kbd></a>
</p>

<div align="center">

<div id="theme-github" class="breakout-theme" style="display:block">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-github-light.svg#gh-light-mode-only" alt="GitHub theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-github-dark.svg#gh-dark-mode-only" alt="GitHub theme breakout" />
</div>

<div id="theme-neon" class="breakout-theme" style="display:none">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-neon-light.svg#gh-light-mode-only" alt="Neon theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-neon-dark.svg#gh-dark-mode-only" alt="Neon theme breakout" />
</div>

<div id="theme-ocean" class="breakout-theme" style="display:none">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-ocean-light.svg#gh-light-mode-only" alt="Ocean theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-ocean-dark.svg#gh-dark-mode-only" alt="Ocean theme breakout" />
</div>

<div id="theme-sunset" class="breakout-theme" style="display:none">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-sunset-light.svg#gh-light-mode-only" alt="Sunset theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-sunset-dark.svg#gh-dark-mode-only" alt="Sunset theme breakout" />
</div>

<div id="theme-retro" class="breakout-theme" style="display:none">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-retro-light.svg#gh-light-mode-only" alt="Retro theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-retro-dark.svg#gh-dark-mode-only" alt="Retro theme breakout" />
</div>

</div>

<br>

<sub>Custom physics engine with sub-step collision detection, angle-based paddle reflection, and predictive paddle tracking. Inspired by <a href="https://github.com/cyprieng/github-breakout">cyprieng/github-breakout</a>.</sub>
