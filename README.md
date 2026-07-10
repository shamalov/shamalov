# Hi there 👋

My contribution graph, turned into a Breakout game — each brick is a day of commits.

### Pick a theme

<p align="center">
  <a href="#t-github"><kbd>🟢 GitHub</kbd></a>&nbsp;
  <a href="#t-neon"><kbd>💜 Neon</kbd></a>&nbsp;
  <a href="#t-ocean"><kbd>🌊 Ocean</kbd></a>&nbsp;
  <a href="#t-sunset"><kbd>🌅 Sunset</kbd></a>&nbsp;
  <a href="#t-retro"><kbd>👾 Retro</kbd></a>
</p>

<a id="t-github"></a>
<a id="t-neon"></a>
<a id="t-ocean"></a>
<a id="t-sunset"></a>
<a id="t-retro"></a>

<div id="breakout-display" align="center">

<div id="panel-github">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-github-light.svg#gh-light-mode-only" alt="GitHub theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-github-dark.svg#gh-dark-mode-only" alt="GitHub theme breakout" />
</div>

<div id="panel-neon">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-neon-light.svg#gh-light-mode-only" alt="Neon theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-neon-dark.svg#gh-dark-mode-only" alt="Neon theme breakout" />
</div>

<div id="panel-ocean">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-ocean-light.svg#gh-light-mode-only" alt="Ocean theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-ocean-dark.svg#gh-dark-mode-only" alt="Ocean theme breakout" />
</div>

<div id="panel-sunset">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-sunset-light.svg#gh-light-mode-only" alt="Sunset theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-sunset-dark.svg#gh-dark-mode-only" alt="Sunset theme breakout" />
</div>

<div id="panel-retro">
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-retro-light.svg#gh-light-mode-only" alt="Retro theme breakout" />
  <img src="https://raw.githubusercontent.com/shamalov/shamalov/github-breakout/images/breakout-retro-dark.svg#gh-dark-mode-only" alt="Retro theme breakout" />
</div>

</div>

<style>
  #breakout-display > div { display: none; }
  #breakout-display > #panel-github { display: block; }

  #t-github:target ~ #breakout-display > div { display: none; }
  #t-github:target ~ #breakout-display > #panel-github { display: block; }

  #t-neon:target ~ #breakout-display > div { display: none; }
  #t-neon:target ~ #breakout-display > #panel-neon { display: block; }

  #t-ocean:target ~ #breakout-display > div { display: none; }
  #t-ocean:target ~ #breakout-display > #panel-ocean { display: block; }

  #t-sunset:target ~ #breakout-display > div { display: none; }
  #t-sunset:target ~ #breakout-display > #panel-sunset { display: block; }

  #t-retro:target ~ #breakout-display > div { display: none; }
  #t-retro:target ~ #breakout-display > #panel-retro { display: block; }
</style>

<br>

<sub>Custom physics engine with sub-step collision detection, angle-based paddle reflection, and predictive paddle tracking. Inspired by <a href="https://github.com/cyprieng/github-breakout">cyprieng/github-breakout</a>.</sub>
