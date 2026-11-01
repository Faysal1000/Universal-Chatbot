# Builds the Hugging Face Space image. Every service is built from its own Dockerfile and the Space
# image copies the results in, so the Space runs exactly what the per-service images run.
#
#   docker buildx bake -f deploy/huggingface-space/docker-bake.hcl --load      # from the repository root

variable "SPACE_IMAGE" {
  default = "universal-chatbot-space:local"
}

# Set by CI to "gha" so each service reuses its layers between runs.
variable "CACHE_BACKEND" {
  default = ""
}

function "cache_from" {
  params = [scope]
  result = CACHE_BACKEND == "" ? [] : ["type=${CACHE_BACKEND},scope=${scope}"]
}

function "cache_to" {
  params = [scope]
  result = CACHE_BACKEND == "" ? [] : ["type=${CACHE_BACKEND},scope=${scope},mode=max"]
}

group "default" {
  targets = ["space"]
}

target "service" {
  target    = "runtime"
  platforms = ["linux/amd64"]
}

target "rag" {
  inherits   = ["service"]
  context    = "services/rag"
  cache-from = cache_from("rag")
  cache-to   = cache_to("rag")
}

target "document-parser" {
  inherits   = ["service"]
  context    = "services/document-parser"
  cache-from = cache_from("document-parser")
  cache-to   = cache_to("document-parser")
}

target "embedding-server" {
  inherits   = ["service"]
  context    = "services/embedding-server"
  args       = { INFERENCE_DEVICE = "cpu" }
  cache-from = cache_from("embedding-server")
  cache-to   = cache_to("embedding-server")
}

target "llm-gateway" {
  inherits   = ["service"]
  context    = "services/llm-gateway"
  cache-from = cache_from("llm-gateway")
  cache-to   = cache_to("llm-gateway")
}

target "local-llm" {
  inherits   = ["service"]
  context    = "services/local-llm"
  args       = { INFERENCE_DEVICE = "cpu" }
  cache-from = cache_from("local-llm")
  cache-to   = cache_to("local-llm")
}

target "admin-console" {
  inherits   = ["service"]
  context    = "services/admin-console"
  args       = { ADMIN_CONSOLE_BASE_PATH = "/admin/" }
  cache-from = cache_from("admin-console")
  cache-to   = cache_to("admin-console")
}

target "frontend-chat-interface" {
  inherits   = ["service"]
  context    = "services/frontend-chat-interface"
  cache-from = cache_from("frontend-chat-interface")
  cache-to   = cache_to("frontend-chat-interface")
}

target "space" {
  context    = "deploy/huggingface-space"
  platforms  = ["linux/amd64"]
  tags       = [SPACE_IMAGE]
  cache-from = cache_from("space")
  cache-to   = cache_to("space")
  contexts = {
    rag                     = "target:rag"
    document-parser         = "target:document-parser"
    embedding-server        = "target:embedding-server"
    llm-gateway             = "target:llm-gateway"
    local-llm               = "target:local-llm"
    admin-console           = "target:admin-console"
    frontend-chat-interface = "target:frontend-chat-interface"
  }
}
