% joss.cls — UNOFFICIAL JOSS-style article class for drafting in LaTeX/Overleaf.
%
% JOSS has no official LaTeX class; its real PDF is produced by the Open Journals
% (Inara) pipeline from paper.md. This class *approximates* that look (A4, left
% metadata sidebar, logo header, sans headings, ORCID author block, footer citation)
% so the team can write the paper in LaTeX on Overleaf. It is derived from the
% Inara-generated LaTeX, with the fragile PDF/A + pandoc-only machinery removed.
%
% Compiles with pdfLaTeX (default fonts) or LuaLaTeX/XeLaTeX (uses the Hack mono
% font if installed, matching JOSS). The official JOSS submission is still paper.md.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{joss}[2026/06/17 Unofficial JOSS-style draft class]
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax
\LoadClass[10pt,a4paper,onecolumn]{article}

\usepackage{marginnote}
\usepackage[rgb,svgnames]{xcolor}
\usepackage{authblk,etoolbox}
\usepackage{titlesec}
\usepackage{calc}
\usepackage{tikz}
\usepackage{caption}
\usepackage{orcidlink}
\usepackage{amssymb,amsmath}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage[round]{natbib}

% --- Fonts: sans by default; Hack mono under Lua/XeTeX if available -----------
\usepackage{iftex}
\renewcommand\familydefault{\sfdefault}
\ifPDFTeX\else
  \usepackage{fontspec}
  \IfFontExistsTF{Hack}{\setmonofont{Hack}}{}
\fi

% --- Page layout: text block with a wide left margin for the metadata sidebar --
\usepackage[top=3.5cm, bottom=3cm, right=1.5cm, left=1.0cm,
            headheight=2.2cm, reversemp, includemp, marginparwidth=4.5cm]{geometry}

% --- Section headings --------------------------------------------------------
\renewcommand{\captionfont}{\small\sffamily}
\renewcommand{\captionlabelfont}{\bfseries}
\titleformat{\section}{\normalfont\sffamily\Large\bfseries}{}{0pt}{}
\titleformat{\subsection}{\normalfont\sffamily\large\bfseries}{}{0pt}{}
\titleformat{\subsubsection}{\normalfont\sffamily\bfseries}{}{0pt}{}
\titleformat*{\paragraph}{\sffamily\normalsize}

% --- Colors + external-link glyph (used in the sidebar) ----------------------
\definecolor{linky}{rgb}{0.0, 0.5, 1.0}
\hypersetup{colorlinks=true, linkcolor=linky, citecolor=linky, urlcolor=linky, breaklinks=true}
\newcommand{\ExternalLink}{%
  \tikz[x=1.2ex, y=1.2ex, baseline=-0.05ex]{%
    \begin{scope}[x=1ex, y=1ex]
      \clip (-0.1,-0.1) --++ (-0, 1.2) --++ (0.6, 0) --++ (0, -0.6) --++ (0.6, 0) --++ (0, -1);
      \path[draw, line width = 0.5, rounded corners=0.5] (0,0) rectangle (1,1);
    \end{scope}
    \path[draw, line width = 0.5] (0.5, 0.5) -- (1, 1);
    \path[draw, line width = 0.5] (0.6, 1) -- (1, 1) -- (1, 0.6);
  }
}

% --- Header (logo) / Footer (citation line) ----------------------------------
% Set the footer citation line with \jossfooter{...} in your paper.
\newcommand{\jossfooter}{Author et al. (Year). Title. \emph{Journal of Open Source Software}.}
\usepackage{fancyhdr}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0.25pt}
\fancyhead[L]{\hspace{-0.75cm}\includegraphics[width=5.5cm]{logo.png}}
\fancyfoot[L]{\parbox[t]{0.98\headwidth}{\footnotesize{\sffamily\jossfooter}}}
\fancyfoot[R]{\sffamily \thepage}
\makeatletter
\let\ps@plain\ps@fancy
\fancyheadoffset[L]{4.5cm}
\fancyfootoffset[L]{4.5cm}

% --- Title / author block: flush left (patches authblk's centering) ----------
\patchcmd{\@maketitle}{center}{flushleft}{}{}
\patchcmd{\@maketitle}{center}{flushleft}{}{}
\patchcmd{\@maketitle}{\LARGE}{\LARGE\sffamily}{}{}
\def\maketitle{{%
  \renewenvironment{tabular}[2][]{\begin{flushleft}}{\end{flushleft}}%
  \AB@maketitle}}
\renewcommand\AB@affilsepx{ \protect\Affilfont}
\renewcommand\AB@affilnote[1]{{\bfseries #1}\hspace{3pt}}
\makeatother
\renewcommand\Authfont{\sffamily\bfseries}
\renewcommand\Affilfont{\sffamily\small\mdseries}
\setlength{\affilsep}{1em}

% --- Metadata sidebar --------------------------------------------------------
% Call \josssidebar{...} right after \maketitle; fill with the JOSS metadata.
\newcommand{\josssidebar}[1]{\marginpar{\begin{flushleft}\sffamily\small #1\end{flushleft}}}
