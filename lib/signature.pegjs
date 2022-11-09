pairs = (","? pair:pair { return pair })+
pair = key:token "=" '"' value:value '"' { return [key, value] }
value = value:[0-9a-zA-Z:\/\.#\-() \+\=]+ { return value.join('') }
token = token:[0-9a-zA-Z]+ { return token.join('') }