variable "openai_api_key_secret_arn" {
  description = "Existing Secrets Manager ARN containing the raw OpenAI API key. Empty disables managed OpenAI features; no secret value belongs in Terraform."
  type        = string
  default     = ""
  validation {
    condition     = trimspace(var.openai_api_key_secret_arn) == "" || can(regex("^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", trimspace(var.openai_api_key_secret_arn)))
    error_message = "openai_api_key_secret_arn must be an exact Secrets Manager secret ARN without wildcards."
  }
}

variable "ctrl_loop_enabled" {
  description = "Opt in to CtrlLoop only after its reviewed schema and provider smoke tests, in dev or QA."
  type        = bool
  default     = false
}

variable "ctrl_loop_model" {
  description = "Managed Agents model used for CtrlLoop automation."
  type        = string
  default     = "gpt-5.6-luna"
  validation {
    condition     = contains(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"], var.ctrl_loop_model)
    error_message = "ctrl_loop_model must be a supported managed Agents model."
  }
}
