module "github_repository" {
  source  = "pagopa-dx/github-environment-bootstrap/github"
  version = "~> 1.0"

  repository = {
    name                   = "selfcare-monorepo-poc"
    description            = "PoC for SelfCare Monorepo structure"
    topics                 = []
    reviewers_teams        = []
  }
}
