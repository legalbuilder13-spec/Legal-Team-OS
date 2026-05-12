from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str
    anthropic_model: str = "claude-opus-4-7"
    database_url: str
    ai_service_token: str | None = None
    salesforce_instance_url: str | None = None
    salesforce_client_id: str | None = None
    salesforce_client_secret: str | None = None
    salesforce_username: str | None = None
    salesforce_password: str | None = None
    port: int = 8000


settings = Settings()
