import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { api } from '../api/index.js'

// The repo the install actually updates from (its git origin). Falls back to the canonical
// upstream when the About payload can't be fetched. The github-shaped deep links (/issues,
// /blob/main/LICENSE) only resolve on github.com, so they are gated on repo_is_github.
const FALLBACK_REPO = 'https://github.com/Arylmera/Geneseed'
const CREATOR_URL = 'https://github.com/Arylmera'

export default function About() {
  const [repo, setRepo] = useState(FALLBACK_REPO)
  const [isGithub, setIsGithub] = useState(true)
  useEffect(() => {
    api
      .docsPage('about')
      .then((p) => {
        if (p?.repo) {
          setRepo(p.repo)
          setIsGithub(!!p.repo_is_github)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div className="narrow">
      <div className="head-row mb-18">
        <div>
          <h1 className="h">About</h1>
          <p className="sub">
            The project, where the source lives, and a word from the person who grew it.
          </p>
        </div>
      </div>

      <div className="card pad-lg mb-16">
        <div className="card-head">
          <h3>Project</h3>
        </div>
        <p className="sub mb-16">
          Geneseed is a portable, theme-able harness you implant once and use everywhere to grow a
          disciplined AI coding agent. One canonical source, many voices, MIT-licensed.
        </p>
        <div className="row wrap gap-10">
          <a className="btn ghost" href={repo} target="_blank" rel="noreferrer">
            <Icon name="github" />
            {isGithub ? 'Source on GitHub' : 'Source repo'}
          </a>
          {isGithub && (
            <>
              <a className="btn ghost" href={repo + '/issues'} target="_blank" rel="noreferrer">
                <Icon name="external" />
                Issues
              </a>
              <a
                className="btn ghost"
                href={repo + '/blob/main/LICENSE'}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="external" />
                MIT License
              </a>
            </>
          )}
        </div>
      </div>

      <div className="card pad-lg">
        <div className="card-head">
          <h3>Creator</h3>
        </div>
        <p className="sub mb-16">
          Geneseed is built by <strong>Guillaume Lemer</strong>. It started as a personal,
          Obsidian-vault-grown agent operating system and was distilled into the repo you are
          running. Implant it once, and a disciplined agent grows around the same inherited rules,
          skills, and memory in every repo it follows you into.
        </p>
        <p className="sub mb-16">
          If you find this useful, a star on the repo or an issue with feedback is the best way to
          help shape what comes next.
        </p>
        <div className="row wrap gap-10">
          <a className="btn ghost" href={CREATOR_URL} target="_blank" rel="noreferrer">
            <Icon name="github" />
            @Arylmera on GitHub
          </a>
        </div>
      </div>
    </div>
  )
}
