# Tablero MexJet

Tablero personal de trabajo (Ventas · Dirección · Personal) para Pablo Velarde.

- App estática de una sola página, servida por GitHub Pages.
- Los datos **no** viven en este repositorio: se guardan en Supabase, protegidos con
  autenticación por correo/contraseña y Row Level Security (cada usuario solo accede a sus propios datos).
- La llave incluida es la clave **pública** (anon) de Supabase, diseñada para uso en cliente;
  por sí sola no otorga acceso a ningún dato.
