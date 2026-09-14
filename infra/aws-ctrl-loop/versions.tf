terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket              = "mangorts-dev-terraform-state-scoobyxd-686458136219"
    key                 = "ctrl-loop/landing/terraform.tfstate"
    region              = "us-west-1"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["686458136219"]
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region              = "us-west-1"
  allowed_account_ids = ["686458136219"]
  default_tags {
    tags = { Project = "CtrlLoop", Purpose = "Public landing page", ManagedBy = "Terraform" }
  }
}

provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = ["686458136219"]
  default_tags {
    tags = { Project = "CtrlLoop", Purpose = "Public landing page", ManagedBy = "Terraform" }
  }
}
